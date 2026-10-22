import java.io.Reader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.AclEntry;
import java.nio.file.attribute.AclEntryType;
import java.nio.file.attribute.AclFileAttributeView;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.Comparator;
import java.util.Locale;
import org.mozilla.javascript.Context;
import org.mozilla.javascript.Scriptable;
import org.mozilla.javascript.ScriptableObject;

/** Real filesystem regression, including NTFS ACLs on the Windows CI runner. */
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

    public static void main(String[] args) throws Exception {
        Path directory = Files.createTempDirectory("tigo-private-credentials-");
        Context cx = Context.enter();
        try {
            cx.setLanguageVersion(Context.VERSION_ES6);
            Scriptable scope = cx.initStandardObjects();
            ScriptableObject.putProperty(scope, "testDirectory", Context.javaToJS(directory, scope));
            try (Reader reader = Files.newBufferedReader(Path.of(args[0]), StandardCharsets.UTF_8)) {
                cx.evaluateReader(scope, reader, "tigo_access_files.js", 1, null);
            }
            cx.evaluateString(scope,
                "var writer=TigoAccessFiles.create(testDirectory,function(path){" +
                "if(!path.startsWith(testDirectory)||java.nio.file.Files.isSymbolicLink(path))throw new Error('Unsafe test path');" +
                "});writer.restrict(testDirectory);" +
                "writer.writePrivate(testDirectory.resolve('llm-api-key'),'FAKE-KEY-FOR-FILESYSTEM-TEST');" +
                "writer.writePrivate(testDirectory.resolve('tigo-access.json'),'{\"source\":\"test\"}');" +
                "writer.writePrivate(testDirectory.resolve('llm-api-key'),'FAKE-KEY-REPLACEMENT');",
                "native-credential-regression", 1, null);
            check(Files.readString(directory.resolve("llm-api-key")).equals("FAKE-KEY-REPLACEMENT"),
                "Atomic replacement must preserve the new contents");
            check(Files.readString(directory.resolve("tigo-access.json")).equals("{\"source\":\"test\"}"),
                "Metadata must be written");
            checkPrivate(directory);
            checkPrivate(directory.resolve("llm-api-key"));
            checkPrivate(directory.resolve("tigo-access.json"));
            try (var children = Files.list(directory)) {
                check(children.count() == 2, "Temporary credential files must be removed");
            }
            System.out.println("Native credential install/replacement and private permissions passed on " +
                System.getProperty("os.name") + "; " + cx.getImplementationVersion());
        } finally {
            Context.exit();
            try (var paths = Files.walk(directory)) {
                for (Path path : paths.sorted(Comparator.reverseOrder()).toList()) Files.deleteIfExists(path);
            }
        }
    }
}
