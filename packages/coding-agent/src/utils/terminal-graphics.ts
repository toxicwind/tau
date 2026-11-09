import { deflateSync, inflateSync } from "node:zlib";
import type { ImageContent } from "@tau/tau-ai";
import { decodeSixelToPng } from "@tau/tau-natives";
import { MAX_IMAGE_INPUT_BYTES, convertImageToPng } from "@tau/tau-tui/chat/image-loading";
