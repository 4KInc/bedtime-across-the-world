/** For tests: whether this page found it is the installed app and entered XR by itself. */
export const pwaRuntime = { installed: false, autoEnter: false };

/**
 * True in the app installed from the Store: Meta's packaged WebXR PWAs expose
 * the Digital Goods service and the browser does not (Meta's "Getting Started
 * with WebXR PWAs" guide uses the same check).
 */
export function isInstalledPwa(): boolean {
  pwaRuntime.installed = typeof (window as Window & { getDigitalGoodsService?: unknown }).getDigitalGoodsService === 'function';
  return pwaRuntime.installed;
}
