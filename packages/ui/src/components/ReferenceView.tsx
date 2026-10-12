import { ApiReferenceReact } from '@scalar/api-reference-react';
import '@scalar/api-reference/style.css';
import type { OpenAPIDoc } from '../lib/spec';

/** Full rendered reference (models included), themed into the ApiDock sheet. Loaded lazily. */
export default function ReferenceView({ doc }: { doc: OpenAPIDoc }) {
  return (
    <div className="reference-sheet -mx-4 mt-6 sm:-mx-8">
      <ApiReferenceReact
        configuration={{
          content: doc,
          hideClientButton: true,
          hideTestRequestButton: true,
          hideDarkModeToggle: true,
          forceDarkModeState: 'light',
          withDefaultFonts: false,
          showSidebar: false,
          showDeveloperTools: 'never',
          telemetry: false,
          agent: { disabled: true },
          documentDownloadType: 'none',
          theme: 'none',
          layout: 'modern',
        }}
      />
    </div>
  );
}
