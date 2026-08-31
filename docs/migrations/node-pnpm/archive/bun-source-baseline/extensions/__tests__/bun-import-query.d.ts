declare module "*?real" {
	import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

	const extension: (pi: ExtensionAPI) => void;
	export default extension;
}
