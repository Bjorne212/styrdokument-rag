export type Source = {
  title: string;
  url: string;
  sectionLabel?: string;
  headings?: string[];
};

export type ChatTurn = { question: string; answer: string };

export class WrongPasswordError extends Error {
  constructor() {
    super("Fel lösenord.");
    this.name = "WrongPasswordError";
  }
}

type StreamHandlers = {
  onSources: (sources: Source[]) => void;
  onToken: (token: string) => void;
  onNotice: (notice: string) => void;
};

export async function streamChat(
  {
    question,
    history,
    password,
    signal,
  }: {
    question: string;
    history: ChatTurn[];
    password: string;
    signal?: AbortSignal;
  },
  handlers: StreamHandlers,
): Promise<void> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-chat-password": password,
    },
    body: JSON.stringify({ question, history: history.slice(-3) }),
    signal: signal ?? null,
  });

  if (response.status === 401) throw new WrongPasswordError();

  if (!response.ok || !response.body) {
    let message = `Något gick fel (${response.status}).`;
    try {
      const data = (await response.json()) as { error?: string };
      if (data?.error) message = data.error;
    } catch {
      /* behåll standardmeddelandet */
    }
    throw new Error(message);
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += value;
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const raw of events) {
      const lines = raw.split("\n");
      const type = lines
        .find((l) => l.startsWith("event:"))
        ?.slice(6)
        .trim();
      const dataLine = lines.find((l) => l.startsWith("data:"));
      if (!type || !dataLine) continue;

      let data: unknown;
      try {
        data = JSON.parse(dataLine.slice(5).trim());
      } catch {
        continue;
      }

      if (type === "sources") handlers.onSources(data as Source[]);
      else if (type === "token") handlers.onToken(String(data));
      else if (type === "notice") handlers.onNotice(String(data));
      else if (type === "error") throw new Error(String(data));
      else if (type === "done") return;
    }
  }
}
