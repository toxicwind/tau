import { theme } from "@tau/tau-tui/theme";
import format, { double } from "@tau/tau-utils/virtual-fixture";
export { theme };
export function render() { return theme.fg("accent", "extension"); }
export function describe(value) { return format(double(value)); }