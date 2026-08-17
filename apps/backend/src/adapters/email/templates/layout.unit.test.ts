import { escapeHtml, renderEmailHtml, renderEmailText } from "./layout";

describe("escapeHtml", () => {
  it("escapes the 5 HTML-significant characters", () => {
    expect(escapeHtml(`<script>alert('x') & "y"</script>`)).toBe(
      "&lt;script&gt;alert(&#39;x&#39;) &amp; &quot;y&quot;&lt;/script&gt;",
    );
  });

  it("leaves plain text untouched", () => {
    expect(escapeHtml("Q3 architecture diagram")).toBe("Q3 architecture diagram");
  });
});

describe("renderEmailHtml", () => {
  it("includes the heading, body, and logo image", () => {
    const html = renderEmailHtml({ heading: "Hello", bodyHtml: "<p>body</p>" });
    expect(html).toContain("Hello");
    expect(html).toContain("<p>body</p>");
    expect(html).toContain("/email-logo.png");
  });

  it("renders a CTA link when provided, and escapes its label", () => {
    const html = renderEmailHtml({
      heading: "Hello",
      bodyHtml: "<p>body</p>",
      cta: { label: "<click>", url: "https://artifact-hub.test/artifacts/1" },
    });
    expect(html).toContain("https://artifact-hub.test/artifacts/1");
    expect(html).toContain("&lt;click&gt;");
    expect(html).not.toContain("<click>");
  });

  it("omits the CTA block entirely when not provided", () => {
    const html = renderEmailHtml({ heading: "Hello", bodyHtml: "<p>body</p>" });
    expect(html).not.toContain("display:inline-block");
  });
});

describe("renderEmailText", () => {
  it("joins heading, body lines, and CTA into plain text", () => {
    const text = renderEmailText({
      heading: "Hello",
      bodyLines: ["line one", "line two"],
      cta: { label: "View", url: "https://artifact-hub.test/x" },
    });
    expect(text).toContain("Hello");
    expect(text).toContain("line one");
    expect(text).toContain("line two");
    expect(text).toContain("View: https://artifact-hub.test/x");
  });
});
