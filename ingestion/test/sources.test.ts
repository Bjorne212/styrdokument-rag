/**
 * Källadaptrarna: vad som räknas som ett dokument i ett arkiv.
 * Kör: npm test i ingestion/.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchPdf } from "../src/extract.ts";
import { parseLinks } from "../src/sources/html-links.ts";

const SECTION = { id: "policys", label: "Policys" };
const PAGE = "https://karen.test/styrdokument/";

test("html-links: PDF-länkar blir dokument, med länktexten som titel", () => {
  const docs = parseLinks(SECTION, PAGE, `
    <a href="alkoholpolicy.pdf">Alkohol&shy;policy</a>
    <a href='/arkiv/Stadga%202026.pdf#sida2'><b>Stadga</b> 2026</a>
    <a href="om-oss.html">Om oss</a>`);
  assert.deepEqual(
    docs.map((d) => [d.url, d.title]),
    [
      ["https://karen.test/styrdokument/alkoholpolicy.pdf", "Alkoholpolicy"],
      ["https://karen.test/arkiv/Stadga%202026.pdf", "Stadga 2026"],
    ],
  );
});

test("html-links: svenska tecken som entiteter avkodas i titeln", () => {
  const [doc] = parseLinks(SECTION, PAGE, `<a href="s.pdf">Stadga f&ouml;r k&aring;ren &#8211; &#x00C4;ndrad</a>`);
  assert.equal(doc?.title, "Stadga för kåren – Ändrad");
});

test("html-links: bara webbadresser, aldrig javascript: eller data:", () => {
  const docs = parseLinks(SECTION, PAGE, `
    <a href="javascript:alert(1)//x.pdf">Elak</a>
    <a href="data:application/pdf;base64,AAAA#.pdf">Inbäddad</a>
    <a href="ftp://karen.test/fil.pdf">FTP</a>
    <a href="http://karen.test/ok.pdf">Ok</a>`);
  assert.deepEqual(docs.map((d) => d.url), ["http://karen.test/ok.pdf"]);
});

test("html-links: samma dokument två gånger blir ett", () => {
  const docs = parseLinks(SECTION, PAGE, `<a href="a.pdf">A</a><a href="a.pdf#s">A igen</a>`);
  assert.equal(docs.length, 1);
});

test("hämtningen vägrar allt som inte är http eller https", async () => {
  const doc = { section: "x", sectionLabel: "X", title: "t", path: "elak.pdf", url: "file:///etc/passwd", uploaded: "", id: "x/elak.pdf" };
  await assert.rejects(fetchPdf(doc), /Inte en webbadress/);
});
