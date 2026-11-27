import java.io.Reader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.AclEntry;
import java.nio.file.attribute.AclEntryType;
import java.nio.file.attribute.AclFileAttributeView;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;
import org.mozilla.javascript.Context;
import org.mozilla.javascript.Scriptable;
import org.mozilla.javascript.ScriptableObject;

/** Real filesystem regression, including NTFS ACLs and held files on the Windows CI runner. */
public class TigoAccessFilesNativeTest {
    private static void check(boolean value, String message) {
        if (!value) throw new AssertionError(message);
    }

    private static void checkPrivate(Path path) throws Exception {
        if (path.getFileSystem().supportedFileAttributeViews().contains("posix")) {
            check(PosixFilePermissions.toString(Files.getPosixFilePermissions(path))
                .equals(Files.isDirectory(path) ? "rwx------" : "rw-------"), "POSIX permissions must be private");
        } else {
            var view = Files.getFileAttributeView(path, AclFileAttributeView.class);
            check(view != null, "Windows ACL view is required");
            var entries = view.getAcl();
            check(entries.size() == 1, "Only the signed-in user should have an ACL entry");
            AclEntry entry = entries.get(0);
            check(entry.type() == AclEntryType.ALLOW, "The user's ACL must allow access");
            String account = entry.principal().getName().toLowerCase(Locale.ROOT);
            String user = System.getProperty("user.name").toLowerCase(Locale.ROOT);
            check(account.equals(user) || account.endsWith("\\" + user), "The ACL must name the current user");
        }
    }

    private interface Hold extends AutoCloseable {
        @Override void close() throws Exception;
    }

    private static void run(String... command) throws Exception {
        check(new ProcessBuilder(command).inheritIO().start().waitFor() == 0, "Command failed: " + String.join(" ", command));
    }

    /**
     * Holds a file the way another reader, an antivirus or an indexer does on Windows: java.io opens it without
     * sharing its deletion, so it cannot be replaced. On macOS the immutable flag refuses the replacement the same
     * way. Returns null where neither is available, or where the platform still lets the file be replaced.
     */
    private static Hold hold(Path path) throws Exception {
        String os = System.getProperty("os.name").toLowerCase(Locale.ROOT);
        Hold hold;
        if (os.startsWith("windows")) {
            var stream = new java.io.FileInputStream(path.toFile());
            hold = stream::close;
        } else if (os.startsWith("mac")) {
            run("chflags", "uchg", path.toString());
            hold = () -> run("chflags", "nouchg", path.toString());
        } else {
            return null;
        }
        Path probe = Files.createTempFile(path.getParent(), "probe-", ".tmp");
        try {
            Files.move(probe, path, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            hold.close();
            return null;
        } catch (java.nio.file.FileSystemException refused) {
            return hold;
        } finally {
            Files.deleteIfExists(probe);
        }
    }

    private static Object eval(Context cx, Scriptable scope, String script) {
        return cx.evaluateString(scope, script, "native-credential-regression", 1, null);
    }

    public static void main(String[] args) throws Exception {
        // Interpreted and compiled: the compiled mode of the 8.5 engine's Rhino once skipped the retry's catch.
        for (int level : new int[] {-1, 9}) {
            scenario(args[0], level);
        }
    }

    @SuppressWarnings("deprecation")
    private static void scenario(String script, int level) throws Exception {
        Path directory = Files.createTempDirectory("tigo-private-credentials-");
        Context cx = Context.enter();
        List<Hold> holds = new ArrayList<>();
        try {
            cx.setLanguageVersion(Context.VERSION_ES6);
            cx.setOptimizationLevel(level);
            Scriptable scope = cx.initStandardObjects();
            ScriptableObject.putProperty(scope, "testDirectory", Context.javaToJS(directory, scope));
            try (Reader reader = Files.newBufferedReader(Path.of(script), StandardCharsets.UTF_8)) {
                cx.evaluateReader(scope, reader, "tigo_access_files.js", 1, null);
            }
            eval(cx, scope,
                "var writer=TigoAccessFiles.create(testDirectory,function(path){" +
                "if(!path.startsWith(testDirectory)||java.nio.file.Files.isSymbolicLink(path))throw new Error('Unsafe test path');" +
                "});writer.restrict(testDirectory);" +
                "writer.writePrivate(testDirectory.resolve('llm-api-key'),'FAKE-KEY-FOR-FILESYSTEM-TEST');" +
                "writer.writePrivate(testDirectory.resolve('tigo-access.json'),'{\"source\":\"test\"}');" +
                "writer.writePrivate(testDirectory.resolve('llm-api-key'),'FAKE-KEY-REPLACEMENT');");
            Path key = directory.resolve("llm-api-key");
            Path metadata = directory.resolve("tigo-access.json");
            check(Files.readString(key).equals("FAKE-KEY-REPLACEMENT"), "Atomic replacement must preserve the new contents");
            check(Files.readString(metadata).equals("{\"source\":\"test\"}"), "Metadata must be written");

            // A refresh with the same contents writes nothing.
            var written = Files.getLastModifiedTime(metadata);
            Thread.sleep(20);
            check(Boolean.FALSE.equals(eval(cx, scope,
                "writer.restrict(testDirectory);writer.writePrivate(testDirectory.resolve('tigo-access.json'),'{\"source\":\"test\"}');")),
                "Identical contents must not be written again");
            check(Files.getLastModifiedTime(metadata).equals(written), "An identical refresh must leave the file untouched");

            String report = "held files not available here";
            Hold held = hold(key);
            if (held != null) {
                holds.add(held);
                // Released after 300 ms: the retried move replaces it.
                Thread release = new Thread(() -> {
                    try { Thread.sleep(300); held.close(); holds.remove(held); } catch (Exception e) { throw new RuntimeException(e); }
                });
                release.start();
                Object attempts = eval(cx, scope,
                    "writer.writePrivate(testDirectory.resolve('llm-api-key'),'FAKE-KEY-AFTER-HOLD');writer.attempts();");
                release.join();
                check(Files.readString(key).equals("FAKE-KEY-AFTER-HOLD"), "A file held for a moment must be replaced once released");
                check(Context.toNumber(attempts) > 1, "The replacement of a held file must have been tried again");

                // Held for good: the old contents stay, the diagnostic names the operation and the cause.
                Hold kept = hold(key);
                check(kept != null, "The second hold must refuse the replacement too");
                holds.add(kept);
                Object line = eval(cx, scope,
                    "var line='';try{writer.writePrivate(testDirectory.resolve('llm-api-key'),'FAKE-KEY-NEVER-WRITTEN');}" +
                    "catch(e){line=TigoAccessFiles.logLine(TigoAccessFiles.failure(e,'write_key',writer.attempts()),false);}line;");
                kept.close();
                holds.remove(kept);
                String text = Context.toString(line);
                check(text.startsWith("TigoAccess local credential installation failed (write_key, ") && text.endsWith(", 6 move attempts"),
                    "A file held for good must fail after six moves with its cause: " + text);
                check(!text.contains(directory.toString()) && !text.contains("FAKE"), "The log line must not show paths or keys");
                check(Files.readString(key).equals("FAKE-KEY-AFTER-HOLD"), "A failed replacement must keep the previous key");
                report = "held file replaced after " + Context.toString(attempts) + " moves, failure logged as \"" + text + "\"";
            }

            // Two tabs (and more) install together while a third reads the metadata: no failure.
            AtomicBoolean writing = new AtomicBoolean(true);
            List<Throwable> errors = Collections.synchronizedList(new ArrayList<>());
            Thread reader = new Thread(() -> {
                // Like the bootstrap of another tab or TigoAccessStatus: short reads, a few milliseconds apart.
                while (writing.get()) {
                    try { Files.readAllBytes(metadata); Thread.sleep(5); } catch (java.nio.file.NoSuchFileException ignored) {
                    } catch (Exception e) { errors.add(e); }
                }
            });
            reader.start();
            List<Thread> writers = new ArrayList<>();
            for (int t = 0; t < 4; t++) {
                final int tab = t;
                Thread writerThread = new Thread(() -> {
                    Context threadContext = Context.enter();
                    try {
                        threadContext.setLanguageVersion(Context.VERSION_ES6);
                        threadContext.setOptimizationLevel(level);
                        for (int i = 0; i < 25; i++) {
                            threadContext.evaluateString(scope,
                                "TigoAccessFiles.serialized(testDirectory,function(){return writer.writePrivate(" +
                                "testDirectory.resolve('tigo-access.json'),'{\"source\":\"test\",\"tab\":" + tab + ",\"n\":" + (i % 2) + "}');});",
                                "concurrent-installation", 1, null);
                        }
                    } catch (Throwable e) {
                        errors.add(e);
                    } finally {
                        Context.exit();
                    }
                });
                writers.add(writerThread);
                writerThread.start();
            }
            for (Thread writerThread : writers) writerThread.join();
            writing.set(false);
            reader.join();
            check(errors.isEmpty(), "Concurrent installations must not fail: " + errors);
            check(Files.readString(metadata).startsWith("{\"source\":\"test\",\"tab\":"), "The last installation must be complete");

            checkPrivate(directory);
            checkPrivate(key);
            checkPrivate(metadata);
            try (var children = Files.list(directory)) {
                check(children.count() == 2, "Temporary credential files must be removed");
            }
            System.out.println("Native credential install/replacement and private permissions passed on " +
                System.getProperty("os.name") + "; " + cx.getImplementationVersion() + ", optimization " + level + "; " + report +
                "; 100 concurrent installations with a reader");
        } finally {
            for (Hold hold : new ArrayList<>(holds)) {
                try { hold.close(); } catch (Exception ignored) {}
            }
            Context.exit();
            try (var paths = Files.walk(directory)) {
                for (Path path : paths.sorted(Comparator.reverseOrder()).toList()) Files.deleteIfExists(path);
            }
        }
    }
}
