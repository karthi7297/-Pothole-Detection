import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Send, Sparkles, X } from 'lucide-react';
import { dataApi } from '../lib/api.js';
import { useAuth } from '../state/AuthContext.jsx';

/**
 * Page-aware assistant.
 *
 * Field Inspector only. It is scoped to the page the inspector is on: the route
 * path is sent to the backend, which grounds every answer in the live data for
 * that page. Navigating to another page resets the conversation so answers stay
 * tied to what is on screen.
 */

let seq = 0;
const nextId = () => `m${(seq += 1)}`;

export default function Assistant() {
  const { user } = useAuth();
  const location = useLocation();
  const page = location.pathname;

  const [open, setOpen] = useState(false);
  const [intro, setIntro] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);

  const bodyRef = useRef(null);
  const inputRef = useRef(null);

  const isInspector = user?.role === 'inspector';

  // Answers are page-scoped: start fresh whenever the inspector changes page.
  useEffect(() => {
    setIntro(null);
    setMessages([]);
    setInput('');
  }, [page]);

  // Load the page greeting + starter questions the first time the panel opens.
  useEffect(() => {
    if (!isInspector || !open || intro) return undefined;
    let alive = true;
    dataApi
      .assistantIntro(page)
      .then((data) => {
        if (!alive) return;
        setIntro(data);
        setMessages([{ id: nextId(), role: 'assistant', text: data.greeting }]);
      })
      .catch(() => {
        if (!alive) return;
        setIntro({ title: 'Field Inspector', suggestions: [], facts: [] });
        setMessages([
          {
            id: nextId(),
            role: 'assistant',
            text: "I'm your RoadPulse assistant. Ask me anything about this page and I'll answer from live data.",
          },
        ]);
      });
    return () => {
      alive = false;
    };
  }, [isInspector, open, intro, page]);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages, busy, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const send = useCallback(
    async (text) => {
      const message = String(text || '').trim();
      if (!message || busy) return;

      const history = messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role, content: m.text }));

      setMessages((prev) => [...prev, { id: nextId(), role: 'user', text: message }]);
      setInput('');
      setBusy(true);

      try {
        const res = await dataApi.assistantChat(message, page, history);
        setMessages((prev) => [
          ...prev,
          { id: nextId(), role: 'assistant', text: res.reply, source: res.source },
        ]);
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          {
            id: nextId(),
            role: 'assistant',
            tone: 'err',
            text:
              err?.message ||
              'I could not reach the assistant service. Check that the backend is running, then try again.',
          },
        ]);
      } finally {
        setBusy(false);
      }
    },
    [busy, messages, page]
  );

  if (!isInspector) return null;

  return (
    <>
      {!open && (
        <button
          type="button"
          className="assistant__fab no-print"
          onClick={() => setOpen(true)}
          aria-label="Open the RoadPulse assistant"
        >
          <Sparkles size={17} />
          <span>Ask Assistant</span>
        </button>
      )}

      {open && (
        <section className="assistant no-print" role="dialog" aria-label="RoadPulse assistant">
          <header className="assistant__head">
            <span className="assistant__mark">
              <Sparkles size={15} />
            </span>
            <div className="assistant__id">
              <div className="assistant__name">RoadPulse Assistant</div>
              <div className="assistant__sub">{intro?.title || 'Field Inspector'}</div>
            </div>
            <button
              type="button"
              className="assistant__close"
              onClick={() => setOpen(false)}
              aria-label="Close assistant"
            >
              <X size={16} />
            </button>
          </header>

          {intro?.facts?.length > 0 && (
            <div className="assistant__facts">
              {intro.facts.map((f) => (
                <span className="assistant__fact" key={f.label}>
                  <b>{f.value}</b> {f.label}
                </span>
              ))}
            </div>
          )}

          <div className="assistant__body" ref={bodyRef}>
            {messages.map((m) => (
              <div key={m.id} className={`assistant__msg assistant__msg--${m.role}`}>
                <div className={`assistant__bubble ${m.tone === 'err' ? 'is-err' : ''}`}>{m.text}</div>
              </div>
            ))}
            {busy && (
              <div className="assistant__msg assistant__msg--assistant">
                <div className="assistant__bubble assistant__typing" aria-label="Thinking">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            )}
          </div>

          {!busy && messages.length <= 1 && intro?.suggestions?.length > 0 && (
            <div className="assistant__sugs">
              {intro.suggestions.map((s) => (
                <button type="button" key={s} className="assistant__chip" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          )}

          <form
            className="assistant__form"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            <input
              ref={inputRef}
              className="assistant__input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={`Ask about ${intro?.title || 'this page'}…`}
              maxLength={2000}
              aria-label="Your question"
            />
            <button
              type="submit"
              className="assistant__send"
              disabled={!input.trim() || busy}
              aria-label="Send question"
            >
              <Send size={15} />
            </button>
          </form>

          <div className="assistant__note">Answers use live data from this page.</div>
        </section>
      )}
    </>
  );
}
