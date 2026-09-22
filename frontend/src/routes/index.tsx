import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import logo from "@/assets/logo.png";
import { kar } from "../../../shared/config";

const TITLE = `${kar.botName} – sök i ${kar.nameGenitive} styrdokument`;
const DESCRIPTION = `Ställ frågor om ${kar.nameGenitive} styrdokument och få svar med länkar till originaldokumenten.`;

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const limits = [
  {
    title: "Sammanställande frågor fungerar inte",
    body: 'Frågor som "i vilka verksamhetsplaner nämns X?" kräver att fler dokument än vad boten klarar av läses. Använd för mer specifika frågor och se länkarna till dokumenten som riktlinjer vart ni kan leta efter mer info.',
  },
  {
    title: "Delad dagskvot",
    body: "Ungefär 80–90 frågor per dygn totalt för alla användare tillsammans.",
  },
];

const faq = [
  {
    q: "Var kommer svaren ifrån?",
    a: `Boten söker i ${kar.nameGenitive} publicerade styrdokument och hämtar de åtta mest relevanta styckena. Svaret formuleras utifrån dem, och källorna visas alltid ovanför svaret.`,
  },
  {
    q: "Sparas mina frågor?",
    a: "Nej. Det finns inga konton, ingen historik och ingen loggning av samtalet. Frågorna lever i webbläsarens minne så länge fliken är öppen och försvinner när du stänger den.",
  },
  {
    q: "Varför behövs ett lösenord?",
    a: "För att begränsa tillgången. För att hålla sig inom den dagliga kvoten och undvika oväntade kostnader.",
  },
  {
    q: "Varför hittar den inte dokument X?",
    a: "Alla dokument hämtas från den publika dokumentsidan. Finns dokumentet inte med där, eller ligger det en föråldrad version där, är det den som används.",
  },
  {
    q: "Kan svaret bli fel?",
    a: "Ja. Boten kan missa ett stycke eller formulera om något felaktigt. Läs alltid källdokumentet innan du fattar beslut eller citerar något.",
  },
  {
    q: "Kan jag lägga till fler dokument?",
    a: "Alla dokument som ligger på den publika dokumentsidan används. Lägg till dokumenten där om de ska kunna användas i frågorna. Indexet uppdateras automatiskt inom sex timmar.",
  },
];

const DOCS_URL = kar.documentsUrl;
const AUTHOR_URL = kar.author.url;

function Index() {
  const navigate = useNavigate();
  const [question, setQuestion] = useState("");

  const go = (q: string) => {
    const trimmed = q.trim().slice(0, 1000);
    navigate({ to: "/chat", search: { q: trimmed || undefined } });
  };

  return (
    <main className="relative min-h-screen bg-hero-bg text-hero-fg">
      <section className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 py-24">
        <div className="hero-aurora" aria-hidden="true" />

        <div className="relative w-full max-w-2xl text-center">
          <img
            src={logo}
            alt={kar.name}
            className="mx-auto h-10 w-auto sm:h-12"
          />

          <h1 className="mt-8 text-4xl font-bold leading-[1.05] tracking-tight sm:text-6xl">
            Vad vill du veta om styrdokumenten?
          </h1>

          <form
            className="mt-10 rounded-3xl border border-hero-border bg-hero-surface p-4 text-left shadow-2xl"
            onSubmit={(e) => {
              e.preventDefault();
              go(question);
            }}
          >
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value.slice(0, 1000))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  go(question);
                }
              }}
              rows={2}
              placeholder={`Ställ en fråga om ${kar.nameGenitive} styrdokument …`}
              className="w-full resize-none bg-transparent px-2 py-1 text-base font-light text-hero-fg outline-none placeholder:text-hero-muted"
            />
            <div className="mt-2 flex items-center justify-between gap-4 px-2">
              <span className="text-xs font-light text-hero-muted">Inget sparas</span>
              <button
                type="submit"
                className="rounded-full bg-primary px-6 py-2.5 text-sm font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Fråga
              </button>
            </div>
          </form>

          <a
            href="#bra-att-veta"
            className="mt-10 inline-block text-xs font-bold uppercase tracking-[0.24em] text-hero-muted transition-colors hover:text-hero-fg"
          >
            Bra att veta &amp; vanliga frågor ↓
          </a>
        </div>
      </section>

      <section id="bra-att-veta" className="mx-auto max-w-4xl px-6 pb-16">
        <h2 className="text-xs font-bold uppercase tracking-[0.28em] text-hero-muted sm:text-sm">
          Bra att veta
        </h2>
        <ul className="mt-6 divide-y divide-hero-border border-y border-hero-border">
          {limits.map((l) => (
            <li key={l.title} className="py-6">
              <h3 className="text-base font-bold sm:text-lg">{l.title}</h3>
              <p className="mt-2 text-sm font-light leading-relaxed text-hero-muted sm:text-base sm:leading-relaxed">
                {l.body}
              </p>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-sm font-light text-hero-muted sm:text-base">
          Vill du läsa dokumenten själv?{" "}
          <a
            href={DOCS_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="font-bold text-primary underline underline-offset-4"
          >
            Öppna {kar.nameGenitive} fullständiga styrdokument
          </a>
          .
        </p>
        <p className="mt-6 text-sm font-light leading-relaxed text-hero-muted sm:text-base sm:leading-relaxed">
          Svaren kan bli fel. Kontrollera alltid påståendena mot originaldokumentet innan du agerar
          på dem.
        </p>
      </section>

      <section className="mx-auto max-w-4xl px-6 pb-24">
        <h2 className="text-xs font-bold uppercase tracking-[0.28em] text-hero-muted sm:text-sm">
          Vanliga frågor
        </h2>
        <div className="mt-5 divide-y divide-hero-border border-y border-hero-border">
          {faq.map((item) => (
            <details key={item.q} className="group py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-bold sm:text-base">
                {item.q}
                <span className="text-hero-muted transition-transform group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 max-w-2xl text-sm font-light leading-relaxed text-hero-muted sm:text-base sm:leading-relaxed">
                {item.a}
              </p>
            </details>
          ))}
        </div>
      </section>

      <footer className="border-t border-hero-border">
        <div className="mx-auto flex max-w-4xl flex-col gap-2 px-6 py-10 text-xs font-light text-hero-muted sm:flex-row sm:items-center sm:justify-between">
          <p>
            Byggt av{" "}
            <a
              href={AUTHOR_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="underline underline-offset-2 transition-colors hover:text-hero-fg"
            >
              {kar.author.name}
            </a>
          </p>
          <a
            href={DOCS_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="transition-colors hover:text-hero-fg"
          >
            {kar.nameGenitive} styrdokument
          </a>
        </div>
      </footer>
    </main>
  );
}
