// Default-export bridge. Module namespaces are already immutable per spec,
// so no Object.freeze wrapper is needed or legal here.
import * as namespace from "./index";
export * from "./index";
export default namespace;
