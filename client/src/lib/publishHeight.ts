// Publishes an element's height on the root element as a CSS custom property
// (e.g. --ticker-h), kept current as it resizes and removed on release, so HUD
// placed relative to it can clear it without threading layout through props.
export function publishHeight(el: HTMLElement, root: HTMLElement, prop: string): () => void {
  const publish = () => root.style.setProperty(prop, `${el.offsetHeight}px`);
  publish();
  const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(publish);
  ro?.observe(el);
  return () => {
    ro?.disconnect();
    root.style.removeProperty(prop);
  };
}
