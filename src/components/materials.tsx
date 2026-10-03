"use client";
import type { ClientSnapshot } from "@crm/core/dto";
import t from "@crm/i18n/translations/en.json";
import { Download, FileText, Folder, Plus, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { dateLabel, errorText, requestJson } from "./crm-app";

export function Materials({
  data,
  organizationId,
  productId,
  refresh,
  onNotice,
  timeZone,
}: {
  data: ClientSnapshot;
  organizationId: string;
  productId: string;
  refresh: () => Promise<void>;
  onNotice: (text: string) => void;
  timeZone: string;
}) {
  const [folderId, setFolderId] = useState("");
  const [stageId, setStageId] = useState("");
  const [dialog, setDialog] = useState<"folder" | "upload" | null>(null);
  const modal = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (dialog && modal.current && !modal.current.open)
      modal.current.showModal();
  }, [dialog]);
  const [formProduct, setFormProduct] = useState(
    productId || data.products[0]?.id || "",
  );
  const [busy, setBusy] = useState(false);
  const product = (id: string) => data.products.find((p) => p.id === id);
  const assets = data.assets.filter(
    (asset) =>
      (!folderId || asset.folderId === folderId) &&
      (!stageId ||
        data.assetStages.some(
          (link) => link.assetId === asset.id && link.stageId === stageId,
        )),
  );
  function open(value: typeof dialog) {
    setFormProduct(productId || data.products[0]?.id || "");
    setDialog(value);
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    setBusy(true);
    try {
      if (dialog === "folder")
        await requestJson("/api/crm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operation: "folder",
            organizationId,
            productId: formProduct,
            name: fields.get("name"),
            parentId: fields.get("parentId") || undefined,
          }),
        });
      else {
        fields.set("organizationId", organizationId);
        fields.set("productId", formProduct);
        await requestJson("/api/materials", { method: "POST", body: fields });
      }
      await refresh();
      setDialog(null);
      onNotice(t.updated);
    } catch (error) {
      onNotice(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  function folderPath(id: string): string {
    const folder = data.folders.find((f) => f.id === id);
    if (!folder) return "";
    return folder.parentId
      ? `${folderPath(folder.parentId)} / ${folder.name}`
      : folder.name;
  }
  return (
    <div className="materials-page">
      <div className="materials-toolbar">
        <select
          aria-label={t.stage}
          value={stageId}
          onChange={(event) => setStageId(event.target.value)}
        >
          <option value="">{t.stageFilter}</option>
          {data.stages.map((stage) => (
            <option value={stage.id} key={stage.id}>
              {product(stage.productId)?.name} · {stage.name}
            </option>
          ))}
        </select>
        <div className="button-row">
          <button type="button" onClick={() => open("folder")}>
            <Plus size={14} />
            {t.newFolder}
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => open("upload")}
          >
            <Upload size={14} />
            {t.upload}
          </button>
        </div>
      </div>
      <div className="library-layout">
        <aside className="folder-sidebar" aria-label={t.folders}>
          <button
            type="button"
            aria-pressed={!folderId}
            onClick={() => setFolderId("")}
          >
            <Folder size={15} />
            {t.allFolders}
            <span>{data.assets.length}</span>
          </button>
          {data.products
            .filter((p) => !productId || p.id === productId)
            .map((p) => (
              <div key={p.id}>
                <div className="nav-label">{p.name}</div>
                {data.folders
                  .filter((folder) => folder.productId === p.id)
                  .map((folder) => (
                    <button
                      type="button"
                      key={folder.id}
                      aria-pressed={folderId === folder.id}
                      onClick={() => setFolderId(folder.id)}
                      title={folderPath(folder.id)}
                    >
                      <Folder size={15} />
                      <span>{folderPath(folder.id)}</span>
                      <small>
                        {
                          data.assets.filter(
                            (asset) => asset.folderId === folder.id,
                          ).length
                        }
                      </small>
                    </button>
                  ))}
              </div>
            ))}
        </aside>
        <div className="asset-list">
          {assets.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{t.name}</th>
                    <th>{t.materialStage}</th>
                    <th>{t.materialStatus}</th>
                    <th>{t.size}</th>
                    <th>
                      <span className="sr-only">{t.download}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {assets.map((asset) => (
                    <tr key={asset.id}>
                      <td>
                        <div className="asset-name">
                          <FileText size={19} />
                          <div>
                            <strong>{asset.name}</strong>
                            <small>
                              {product(asset.productId)?.name} ·{" "}
                              {folderPath(asset.folderId)} ·{" "}
                              {dateLabel(asset.createdAt, timeZone)}
                            </small>
                          </div>
                        </div>
                      </td>
                      <td>
                        {data.assetStages
                          .filter((link) => link.assetId === asset.id)
                          .map((link) => (
                            <span className="badge" key={link.stageId}>
                              {
                                data.stages.find(
                                  (stage) => stage.id === link.stageId,
                                )?.name
                              }
                            </span>
                          ))}
                      </td>
                      <td>
                        <span className="badge">
                          {asset.status === "approved"
                            ? t.approvedAsset
                            : asset.status === "archived"
                              ? t.archivedAsset
                              : t.draftAsset}
                        </span>
                      </td>
                      <td>{Math.ceil(asset.size / 1024)} KB</td>
                      <td>
                        <a
                          className="icon-button"
                          href={`/api/materials?organizationId=${organizationId}&assetId=${asset.id}`}
                          aria-label={`${t.download} ${asset.name}`}
                        >
                          <Download size={16} />
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="materials-empty">
              <div className="empty-icon">
                <Folder size={26} />
              </div>
              <h2>{t.materials}</h2>
              <p>{t.materialsEmpty}</p>
              <button
                type="button"
                className="primary"
                onClick={() => open("upload")}
              >
                <Upload size={14} />
                {t.upload}
              </button>
            </div>
          )}
          <p className="library-note">{t.materialNote}</p>
        </div>
      </div>
      {dialog && (
        <dialog
          ref={modal}
          className="dialog"
          aria-labelledby="material-dialog-title"
          onCancel={(event) => {
            if (busy) event.preventDefault();
            else setDialog(null);
          }}
        >
          <div className="section-heading">
            <h2 id="material-dialog-title">
              {dialog === "folder" ? t.newFolder : t.upload}
            </h2>
            <button
              type="button"
              className="icon-button"
              aria-label={t.cancel}
              onClick={() => setDialog(null)}
              disabled={busy}
            >
              <X size={16} />
            </button>
          </div>
          <form onSubmit={submit}>
            <label>
              {t.product}
              <select
                value={formProduct}
                onChange={(event) => setFormProduct(event.target.value)}
                required
              >
                {data.products
                  .filter((p) => !productId || p.id === productId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
            {dialog === "folder" ? (
              <>
                <label>
                  {t.folderName}
                  <input name="name" required maxLength={100} />
                </label>
                <label>
                  {t.parentFolder}
                  <select name="parentId" key={formProduct}>
                    <option value="">{t.rootFolder}</option>
                    {data.folders
                      .filter((f) => f.productId === formProduct)
                      .map((f) => (
                        <option key={f.id} value={f.id}>
                          {folderPath(f.id)}
                        </option>
                      ))}
                  </select>
                </label>
              </>
            ) : (
              <>
                <label>
                  {t.folder}
                  <select
                    name="folderId"
                    key={formProduct}
                    required
                    defaultValue={
                      data.folders.some(
                        (f) => f.id === folderId && f.productId === formProduct,
                      )
                        ? folderId
                        : undefined
                    }
                  >
                    {data.folders
                      .filter((f) => f.productId === formProduct)
                      .map((f) => (
                        <option key={f.id} value={f.id}>
                          {folderPath(f.id)}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  {t.file}
                  <input
                    name="file"
                    type="file"
                    required
                    accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
                  />
                </label>
                <p className="muted">{t.uploadHint}</p>
                <fieldset>
                  <legend>{t.materialStage}</legend>
                  {data.stages
                    .filter((stage) => stage.productId === formProduct)
                    .map((stage) => (
                      <label className="checkbox-label" key={stage.id}>
                        <input
                          name="stageIds"
                          type="checkbox"
                          value={stage.id}
                        />
                        {stage.name}
                      </label>
                    ))}
                </fieldset>
                <p className="muted">{t.uploadStageHint}</p>
              </>
            )}
            <div className="dialog-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => setDialog(null)}
              >
                {t.cancel}
              </button>
              <button
                type="submit"
                className="primary"
                disabled={
                  busy ||
                  !formProduct ||
                  (dialog === "upload" &&
                    !data.folders.some((f) => f.productId === formProduct))
                }
              >
                {busy ? t.saving : dialog === "folder" ? t.create : t.upload}
              </button>
            </div>
          </form>
        </dialog>
      )}
    </div>
  );
}
