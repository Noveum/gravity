"use client";
import type { ClientContext } from "@crm/core/dto";
import t from "@crm/i18n/translations/en.json";
import { LockKeyhole, Share2 } from "lucide-react";
import { useState } from "react";
import { label } from "../client-api";
import { RecordDialog } from "./record-dialog";

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
  ) => Promise<string | null>;
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
            disabled={busy || !!selected}
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
  ) => Promise<string | null>;
}) {
  const sharing = source.visibility === "private";
  return (
    <RecordDialog
      inline
      title={sharing ? t.shareThread : t.unshareThread}
      submitLabel={sharing ? t.shareThread : t.unshareThread}
      loading={busy}
      onClose={onClose}
      onSubmit={() => onChange(source, sharing ? "product" : "private")}
    >
      <p>
        {(sharing
          ? t.shareThreadDescription
          : t.unshareThreadDescription
        ).replace("{product}", productName)}
      </p>
    </RecordDialog>
  );
}
