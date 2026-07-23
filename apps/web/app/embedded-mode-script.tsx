const embeddedModeScript = `
(function () {
  if (window.self !== window.top) {
    document.documentElement.dataset.embedded = 'true';
  }
})();
`;

export function EmbeddedModeScript() {
  return <script dangerouslySetInnerHTML={{ __html: embeddedModeScript }} />;
}
