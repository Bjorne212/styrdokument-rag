import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useChat, type Message } from "../lib/use-chat";
import type { Source } from "../lib/chat-api";
import logo from "@/assets/logo.png";
import { kar } from "../../../shared/config";

const STORAGE_KEY = `${kar.id}-password`;
const MAX_LENGTH = 1000;

export const Route = createFileRoute("/chat")({
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search["q"] === "string" ? (search["q"] as string).slice(0, 1000) : undefined,
  }),
  head: () => ({
    meta: [
      { title: `Chatt – ${kar.botName}` },
      {
        name: "description",
        content:
          `Ställ frågor om ${kar.nameGenitive} styrdokument och få svar med källhänvisningar. Inget sparas mellan besöken.`,
      },
      { property: "og:title", content: `Chatt – ${kar.botName}` },
      {
        property: "og:description",
        content:
          `Ställ frågor om ${kar.nameGenitive} styrdokument och få svar med källhänvisningar. Inget sparas mellan besöken.`,
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ChatPage,
});

function ChatPage() {
  const { q } = Route.useSearch();
  const [password, setPassword] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  useEffect(() => {
    setPassword(sessionStorage.getItem(STORAGE_KEY));
    setReady(true);
  }, []);

  const handleWrongPassword = useCallback(() => {
    sessionStorage.removeItem(STORAGE_KEY);
    setPassword(null);
    setPasswordError("Fel lösenord. Försök igen.");
  }, []);

  const savePassword = (value: string) => {
    sessionStorage.setItem(STORAGE_KEY, value);
    setPasswordError(null);
    setPassword(value);
  };

  if (!ready) return null;

  return (
    <div className="relative flex min-h-screen flex-col bg-hero-bg text-hero-fg">
      <header className="border-b border-hero-border">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link to="/" className="transition-opacity hover:opacity-80">
            <img
              src={logo}
              alt={kar.name}
              className="h-7 w-auto"
            />
          </Link>
          <span className="text-xs font-light text-hero-muted">Inget sparas</span>
        </div>
      </header>

      {password ? (
        <Conversation
          password={password}
          initialQuestion={q}
          onWrongPassword={handleWrongPassword}
        />
      ) : (
        <PasswordGate error={passwordError} onSubmit={savePassword} />
      )}
    </div>
  );
}

function PasswordGate({
  error,
  onSubmit,
}: {
  error: string | null;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState("");

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-16">
      <h1 className="text-2xl font-bold tracking-tight text-hero-fg">
        Ange lösenord för att fortsätta.
      </h1>
      <form
        className="mt-6 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) onSubmit(value.trim());
        }}
      >
        <input
          type="password"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Delat lösenord"
          className="w-full rounded-xl border border-hero-border bg-hero-surface px-4 py-3 text-base text-hero-fg outline-none transition-colors focus:border-primary"
        />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <button
          type="submit"
          disabled={!value.trim()}
          className="w-full rounded-full bg-primary px-6 py-3 text-sm font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
        >
          Fortsätt
        </button>
      </form>
    </main>
  );
}

function Conversation({
  password,
  initialQuestion,
  onWrongPassword,
}: {
  password: string;
  initialQuestion?: string | undefined;
  onWrongPassword: () => void;
}) {
  const { messages, isStreaming, send, stop, clear } = useChat({ password, onWrongPassword });
  const [input, setInput] = useState(initialQuestion ?? "");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const submit = () => {
    if (!input.trim() || isStreaming) return;
    send(input.trim());
    setInput("");
  };

  return (
    <>
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
        {messages.length === 0 ? (
          <div className="border border-hero-border bg-hero-surface p-6">
            <h1 className="text-lg font-bold text-hero-fg">Ställ din fråga</h1>
            <p className="mt-2 text-sm font-light leading-relaxed text-hero-muted">
              Boten minns de två senaste frågorna i samtalet så att följdfrågor fungerar. Vill du
              byta ämne? Ladda om sidan för att börja om från noll.
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {messages.map((m) => (
              <MessageView key={m.id} message={m} isStreaming={isStreaming} />
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </main>

      <footer className="sticky bottom-0 border-t border-hero-border bg-hero-bg/95 backdrop-blur">
        <div className="mx-auto w-full max-w-3xl px-6 py-4">
          <div className="rounded-2xl border border-hero-border bg-hero-surface p-2 focus-within:border-primary focus-within:ring-1 focus-within:ring-primary">
            <textarea
              value={input}
              rows={2}
              maxLength={MAX_LENGTH}
              placeholder="Skriv din fråga…"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              className="w-full resize-none bg-transparent px-3 py-2 text-base font-light text-hero-fg outline-none placeholder:text-hero-muted"
            />
            <div className="flex items-center justify-between gap-3 px-3 pb-1">
              <span className="text-xs font-light text-hero-muted">
                {input.length}/{MAX_LENGTH} tecken
              </span>
              <div className="flex items-center gap-2">
                {messages.length > 0 && !isStreaming ? (
                  <button
                    onClick={clear}
                    className="rounded-full px-3 py-2 text-xs font-bold uppercase tracking-widest text-hero-muted transition-colors hover:text-hero-fg"
                  >
                    Rensa samtalet
                  </button>
                ) : null}
                {isStreaming ? (
                  <button
                    onClick={stop}
                    className="rounded-full border border-hero-border px-5 py-2 text-xs font-bold uppercase tracking-widest text-hero-fg transition-colors hover:bg-hero-surface"
                  >
                    Avbryt
                  </button>
                ) : (
                  <button
                    onClick={submit}
                    disabled={!input.trim()}
                    className="rounded-full bg-primary px-6 py-2 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
                  >
                    Skicka
                  </button>
                )}
              </div>
            </div>
          </div>
          <p className="mt-3 text-center text-xs font-light text-hero-muted">
            Svaren kan bli fel – kontrollera alltid mot källdokumentet.
          </p>
        </div>
      </footer>
    </>
  );
}

function MessageView({ message, isStreaming }: { message: Message; isStreaming: boolean }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap bg-primary/15 px-4 py-3 text-base text-hero-fg">
          {message.text}
        </p>
      </div>
    );
  }

  const waiting = !message.text && !message.error;

  return (
    <div className="space-y-3">
      {message.sources && message.sources.length > 0 ? (
        <SourceList sources={message.sources} />
      ) : null}

      {waiting ? <Waiting active={isStreaming} /> : null}

      {message.text ? (
        <p className="whitespace-pre-wrap text-base font-light leading-relaxed text-hero-fg">
          {message.text}
          {isStreaming ? <span className="ml-0.5 animate-pulse text-primary">▍</span> : null}
        </p>
      ) : null}

      {message.notice ? (
        <p className="text-xs font-light text-hero-muted">{message.notice}</p>
      ) : null}

      {message.error ? (
        <p className="border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {message.error}
        </p>
      ) : null}
    </div>
  );
}

function Waiting({ active }: { active: boolean }) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [active]);

  return (
    <div className="flex items-center gap-3 text-sm font-light text-hero-muted">
      <span className="flex gap-1">
        <span className="h-2 w-2 animate-bounce rounded-full bg-primary [animation-delay:-0.3s]" />
        <span className="h-2 w-2 animate-bounce rounded-full bg-primary [animation-delay:-0.15s]" />
        <span className="h-2 w-2 animate-bounce rounded-full bg-primary" />
      </span>
      Söker i styrdokumenten… {seconds} s
    </div>
  );
}

function SourceList({ sources }: { sources: Source[] }) {
  return (
    <div className="border border-hero-border bg-hero-surface p-4">
      <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-hero-muted">Källor</h2>
      <ul className="mt-3 space-y-2">
        {sources.map((s) => (
          <li key={s.url}>
            <a
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group block border border-transparent bg-white/[0.03] px-3 py-2 transition-colors hover:border-primary"
            >
              <span className="text-sm font-bold text-hero-fg group-hover:text-primary">
                {s.title}
              </span>
              {s.sectionLabel ? (
                <span className="ml-2 text-xs font-light text-hero-muted">{s.sectionLabel}</span>
              ) : null}
              {s.headings && s.headings.length > 0 ? (
                <span className="mt-1 block text-xs font-light text-hero-muted">
                  {s.headings.join(" · ")}
                </span>
              ) : null}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
