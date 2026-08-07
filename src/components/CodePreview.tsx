import { useState } from "react";

/** Lightweight TypeScript syntax highlighter for the generated source. */
function syntaxLine(line: string) {
  const tokens = line.split(
    /("[^"\n]*"|'[^'\n]*'|\/\/.*|\b(?:import|from|export|interface|const|let|new|return|for|function|Partial|number)\b|\bTHREE\.[A-Za-z]+\b|\b\d+(?:\.\d+)?\b)/g,
  );
  return tokens.map((token, index) => {
    let className = "";
    if (/^\/\//.test(token)) className = "syn-comment";
    else if (/^["']/.test(token)) className = "syn-string";
    else if (/^(import|from|export|interface|const|let|new|return|for|function|Partial|number)$/.test(token))
      className = "syn-keyword";
    else if (/^THREE\./.test(token)) className = "syn-type";
    else if (/^\d/.test(token)) className = "syn-number";
    return (
      <span className={className} key={`${token}-${index}`}>
        {token}
      </span>
    );
  });
}

export function CodePreview({ code }: { code: string }) {
  const lines = code.split("\n");
  const [hoveredLine, setHoveredLine] = useState<number | null>(null);
  return (
    <div className="code-scroll">
      <pre className="line-numbers" aria-hidden="true">
        {lines.map((_, index) => `${index + 1}\n`)}
      </pre>
      <pre className="code-content">
        <code>
          {lines.map((line, index) => (
            <span
              className="code-line"
              key={index}
              onMouseEnter={() => setHoveredLine(index)}
              onMouseLeave={() => setHoveredLine(null)}
              style={hoveredLine === index ? { background: "rgba(112,210,191,0.06)" } : undefined}
            >
              {syntaxLine(line)}
              {"\n"}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
