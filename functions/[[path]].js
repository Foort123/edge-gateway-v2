import { connect } from "cloudflare:sockets";
import { createPagesHandler } from "./_lib/handler.js";

export const onRequest = createPagesHandler({ connect });
