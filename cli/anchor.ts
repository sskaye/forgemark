// The anchor locator lives in the format layer now, where the app uses
// it too; the CLI's name for it is kept for its callers and tests.
export {
  locateAnchor,
  locateElement,
  applyPlacement,
  AnchorError,
  type Placement,
  type LocateOptions,
} from "../src/format/locate";
