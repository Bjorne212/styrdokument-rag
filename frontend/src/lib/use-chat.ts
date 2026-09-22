import { useCallback, useRef, useState } from "react";
import { streamChat, WrongPasswordError, type Source } from "./chat-api";

const TIMEOUT_MS = 120000;

export type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  sources?: Source[];
  notice?: string;
  error?: string;
};

function newId() {
  return Math.random().toString(36).slice(2);
}

export function useChat({
  password,
  onWrongPassword,
}: {
  password: string;
  onWrongPassword: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const update = useCallback((id: string, patch: Partial<Message>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const clear = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
  }, []);

  const send = useCallback(
    async (question: string) => {
      const trimmed = question.trim();
      if (!trimmed || isStreaming) return;

      const history: { question: string; answer: string }[] = [];
      for (let i = 0; i < messages.length - 1; i++) {
        const q = messages[i];
        const a = messages[i + 1];
        if (q && a && q.role === "user" && a.role === "assistant" && a.text) {
          history.push({ question: q.text, answer: a.text });
        }
      }

      const answerId = newId();
      setMessages((prev) => [
        ...prev,
        { id: newId(), role: "user", text: trimmed },
        { id: answerId, role: "assistant", text: "" },
      ]);
      setIsStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;
      const timer = setTimeout(() => controller.abort("timeout"), TIMEOUT_MS);

      try {
        await streamChat(
          { question: trimmed, history, password, signal: controller.signal },
          {
            onSources: (sources) => update(answerId, { sources }),
            onToken: (token) =>
              setMessages((prev) =>
                prev.map((m) => (m.id === answerId ? { ...m, text: m.text + token } : m)),
              ),
            onNotice: (notice) => update(answerId, { notice }),
          },
        );
      } catch (err) {
        if (err instanceof WrongPasswordError) {
          setMessages((prev) => prev.filter((m) => m.id !== answerId));
          onWrongPassword();
        } else if (controller.signal.aborted) {
          update(answerId, {
            error:
              controller.signal.reason === "timeout"
                ? "Svaret tog längre än två minuter. Försök igen, gärna med en kortare fråga."
                : "Svaret avbröts.",
          });
        } else {
          update(answerId, {
            error: err instanceof Error ? err.message : "Något gick fel. Försök igen.",
          });
        }
      } finally {
        clearTimeout(timer);
        abortRef.current = null;
        setIsStreaming(false);
      }
    },
    [isStreaming, messages, password, onWrongPassword, update],
  );

  return { messages, isStreaming, send, stop, clear };
}
