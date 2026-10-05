import { gravityIdentity } from "@crm/brand/identity";
import { ImageResponse } from "next/og";
import { GravityMark } from "@/components/gravity-logo";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: gravityIdentity.light,
      }}
    >
      <GravityMark size={120} color={gravityIdentity.inverse} />
    </div>,
    size,
  );
}
