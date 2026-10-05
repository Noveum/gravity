import t from "@crm/i18n/translations/en.json";
import { ImageResponse } from "next/og";
import { GravityMark } from "@/components/gravity-logo";

export const alt = `${t.brand} · ${t.brandSub}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "64px 72px",
        background: "#101117",
        color: "#f0f0f2",
        fontFamily: "sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 18,
          color: "#7b83eb",
        }}
      >
        <GravityMark size={60} />
        <span
          style={{
            fontSize: 44,
            fontWeight: 600,
            letterSpacing: -2,
            color: "#f0f0f2",
          }}
        >
          {t.brand}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div
          style={{
            fontSize: 76,
            letterSpacing: -3,
            lineHeight: 1.08,
            maxWidth: 900,
            whiteSpace: "pre-line",
          }}
        >
          {t.authStoryTitle}
        </div>
        <div style={{ fontSize: 24, color: "#a4a9b9", maxWidth: 820 }}>
          {t.authStoryDescription}
        </div>
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 18,
          color: "#a4a9b9",
        }}
      >
        <span>{t.brandSub}</span>
        <span>
          {t.authOpenSource} · {t.authLicense}
        </span>
      </div>
    </div>,
    size,
  );
}
