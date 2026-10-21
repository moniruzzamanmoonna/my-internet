// TEST FIXTURES ONLY. These tiny feeds exist so tests can run offline. They are
// never served by the app itself; the app only ever shows real, fetched feeds.
export const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel><title>Fixture RSS</title><link>https://fixture.test/</link><description>Test feed</description>
<item><title>Newest &amp; best</title><link>https://fixture.test/a?utm_source=x</link><pubDate>Tue, 20 Oct 2026 10:00:00 GMT</pubDate><description>&lt;p&gt;Hello &lt;b&gt;world&lt;/b&gt;&lt;script&gt;alert(1)&lt;/script&gt;&lt;/p&gt;</description><dc:creator>Ann</dc:creator><media:thumbnail url="https://fixture.test/i.jpg"/></item>
<item><title>Older story</title><link>https://fixture.test/b</link><pubDate>Mon, 19 Oct 2026 10:00:00 GMT</pubDate><description>Plain text</description></item>
<item><title>Duplicate of newest</title><link>https://www.fixture.test/a/</link><pubDate>Tue, 20 Oct 2026 09:00:00 GMT</pubDate></item>
<item><title>Bad link item</title><link>javascript:alert(1)</link></item>
</channel></rss>`;

export const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>Fixture Atom</title><link href="https://atom.test/"/>
<entry><title>Atom entry</title><link rel="alternate" href="https://atom.test/1"/><updated>2026-10-18T08:00:00Z</updated><summary>An atom summary</summary></entry>
</feed>`;

export const RDF = `<?xml version="1.0"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel rdf:about="https://rdf.test/"><title>Fixture RDF</title><link>https://rdf.test/</link></channel>
<item rdf:about="https://rdf.test/1"><title>RDF item</title><link>https://rdf.test/1</link><dc:date>2026-10-17T00:00:00Z</dc:date></item>
</rdf:RDF>`;

export const HTML_PAGE = `<!doctype html><html><head><title>A site</title>
<link rel="alternate" type="application/rss+xml" title="Site feed" href="/feed.xml"></head><body>hi</body></html>`;

export const XXE = `<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY a "AAAA"><!ENTITY b "&a;&a;&a;&a;">]>
<rss version="2.0"><channel><title>&b;</title><item><title>t</title><link>https://x.test/1</link></item></channel></rss>`;
