/** Lazy boundary for personal extension-profile launch. */
export async function getExtensionProfileLaunchModule() {
  return await import("./extension-profile-launch.js");
}
