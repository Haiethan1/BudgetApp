export const appNavigationEvent = "homebooks-before-navigation";

export function requestAppNavigation({ href, navigate }: { href: string; navigate: (href: string) => void }) {
  if (window.dispatchEvent(new CustomEvent(appNavigationEvent, { cancelable: true, detail: { href } }))) navigate(href);
}
