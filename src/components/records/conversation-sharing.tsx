"use client";
import type { ClientContext } from "@crm/core/dto";
import t from "@crm/i18n/translations/en.json";
import { LockKeyhole, Share2 } from "lucide-react";
import { useRef, useState } from "react";
import { label } from "../client-api";
import { submitOnSaveKey, useModalLifecycle } from "../modal-lifecycle";

type Conversation = ClientContext["conversations"][number];
export function ConversationSharing({
  conversations,
  userId,
  productName,
  busy,
  onChange,
}: {
  conversations: Conversation[];
  userId: string;
  productName: string;
  busy: boolean;
  onChange: (
    source: Conversation,
    visibility: "private" | "product",
  ) => Promise<boolean>;
}) {
  const [selected, setSelected] = useState<Conversation | null>(null);
  const owned = conversations.filter((source) => source.ownerId === userId);
  if (!owned.length) return null;
  return (
    <section className="conversation-sharing" aria-label={t.conversationAccess}>
      <h3>{t.conversationAccess}</h3>
      <p className="muted">{t.conversationPrivacyNote}</p>
      {owned.map((source, index) => (
        <div className="conversation-sharing-row" key={source.id}>
          <div className="conversation-sharing-thread">
            {t.conversationThread
              .replace("{channel}", label(source.channel))
              .replace("{number}", String(index + 1))}
            <small>
              {source.visibility === "private"
                ? t.conversationPrivate
                : t.conversationShared}
            </small>
            {source.preview && (
              <p className="conversation-sharing-preview">
                {t.latestThreadMessage.replace("{message}", source.preview)}
              </p>
            )}
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => setSelected(source)}
          >
            {source.visibility === "private" ? (
              <Share2 size={14} aria-hidden="true" />
            ) : (
              <LockKeyhole size={14} aria-hidden="true" />
            )}
            {source.visibility === "private" ? t.shareThread : t.unshareThread}
          </button>
        </div>
      ))}
      {selected && (
        <SharingDialog
          key={selected.id}
          source={selected}
          productName={productName}
          busy={busy}
          onClose={() => setSelected(null)}
          onChange={onChange}
        />
      )}
    </section>
  );
}
function SharingDialog({
  source,
  productName,
  busy,
  onClose,
  onChange,
}: {
  source: Conversation;
  productName: string;
  busy: boolean;
  onClose: () => void;
  onChange: (
    source: Conversation,
    visibility: "private" | "product",
  ) => Promise<boolean>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  useModalLifecycle(dialog);
  const sharing = source.visibility === "private";
  const disabled = busy || submitting;
  return (
    <dialog
      ref={dialog}
      aria-labelledby="thread-sharing-title"
      aria-describedby="thread-sharing-description"
      onCancel={(event) => {
        event.preventDefault();
        if (!disabled) onClose();
      }}
    >
      <form
        onKeyDown={submitOnSaveKey}
        onSubmit={async (event) => {
          event.preventDefault();
          if (pending.current || busy) return;
          pending.current = true;
          setSubmitting(true);
          try {
            if (await onChange(source, sharing ? "product" : "private"))
              onClose();
          } finally {
            pending.current = false;
            setSubmitting(false);
          }
        }}
      >
        <h2 id="thread-sharing-title">
          {sharing ? t.shareThread : t.unshareThread}
        </h2>
        <p id="thread-sharing-description">
          {(sharing
            ? t.shareThreadDescription
            : t.unshareThreadDescription
          ).replace("{product}", productName)}
        </p>
        <div className="button-row">
          <button
            type="button"
            disabled={disabled}
            onClick={onClose}
            data-modal-cancel
          >
            {t.cancel}
          </button>
          <button type="submit" disabled={disabled} className="primary">
            {sharing ? t.shareThread : t.unshareThread}
          </button>
        </div>
      </form>
    </dialog>
  );
}
