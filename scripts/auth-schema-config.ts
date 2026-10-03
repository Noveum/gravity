import { betterAuth } from "better-auth";
import { appUrl, authPlugins } from "../packages/auth/options";
export const auth = betterAuth({ baseURL: appUrl(), plugins: authPlugins() });
