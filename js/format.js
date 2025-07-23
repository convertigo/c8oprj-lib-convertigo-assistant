function formatLiteral(s) {
	return `${s}`;
}

function fixMalformedJson(jsonStr) {
  // Remove escaped quotes around string values like: \"value\"
  // but leave escaped quotes **within** strings intact
  const fixQuotedValues = (str) => {
    return str.replace(/:\s*\\"(.*?)\\"/g, (_, val) => {
      // Unescape inner escaped quotes (from JS-style string)
      const cleaned = val.replace(/\\"/g, '"');
      return `: "${cleaned}"`;
    });
  };

  // Handle special case where value starts and ends with \"
  const fixEdgeQuoteWraps = (str) => {
    return str.replace(/:\s*\\?"([^"]*?)\\?"(?=\s*[,\}])/g, (match, val) => {
      return `: "${val}"`;
    });
  };

  // Run both fixers
  let fixed = fixQuotedValues(jsonStr);
  fixed = fixEdgeQuoteWraps(fixed);
  return fixed;
  
  // Try parsing
  /*try {
    return JSON.parse(fixed);
  } catch (err) {
    log.error("Still invalid JSON:"+ err.message);
    return null;
  }*/
}
