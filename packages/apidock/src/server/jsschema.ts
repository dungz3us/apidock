import * as ajv2020 from 'ajv/dist/2020.js';
import addFormatsCjs, { type FormatsPlugin } from 'ajv-formats';
import type { ErrorObject, ValidateFunction } from 'ajv/dist/2020.js';
import type { OpenAPIDoc } from './mock.js';

// ajv and ajv-formats are CJS; under NodeNext their default imports resolve to namespaces.
const Ajv2020 = ((ajv2020 as unknown as { default?: unknown }).default ?? ajv2020) as unknown as typeof ajv2020.Ajv2020;
const addFormats = ((addFormatsCjs as unknown as { default?: unknown }).default ?? addFormatsCjs) as FormatsPlugin;

const DOC_ID = 'apidock-doc';

export interface SchemaIssue {
  path: string;
  message: string;
  location: 'response';
}

export interface ValidationReport {
  /** null when nothing was declared for this status (caller decides how to treat it). */
  declared: boolean;
  issues: SchemaIssue[];
}

const docCache = new WeakMap<object, { validate: (pointer: string) => ValidateFunction | undefined }>();

function validatorFor(doc: OpenAPIDoc): (pointer: string) => ValidateFunction | undefined {
  let cached = docCache.get(doc);
  if (!cached) {
    const ajv = addFormats(new Ajv2020({ strict: false, allErrors: true }));
    ajv.addSchema(doc, DOC_ID);
    const compiled = new Map<string, ValidateFunction | undefined>();
    cached = {
      validate: (pointer) => {
        if (!compiled.has(pointer)) {
          try {
            compiled.set(pointer, ajv.compile({ $ref: `${DOC_ID}#${pointer}` }));
          } catch {
            compiled.set(pointer, undefined);
          }
        }
        return compiled.get(pointer);
      },
    };
    docCache.set(doc, cached);
  }
  return cached.validate;
}

const esc = (seg: string) => seg.replace(/~/g, '~0').replace(/\//g, '~1');

const isJsonMedia = (type: string) => /(^|\+|\/)(json|problem\+json)(;|$)/i.test(type);

/** Parse an HTTP body string to JSON when the media type says so; undefined when empty. */
export function parseBody(body: string, mediaType: string | undefined): unknown {
  if (!body.trim()) return undefined;
  if (mediaType && isJsonMedia(mediaType)) {
    try {
      return JSON.parse(body);
    } catch {
      return body;
    }
  }
  return body;
}

export function validateResponseBody(
  doc: OpenAPIDoc,
  pathTemplate: string,
  method: string,
  status: number,
  body: unknown,
): ValidationReport {
  const op = doc.paths?.[pathTemplate]?.[method.toLowerCase()] as { responses?: Record<string, { content?: Record<string, { schema?: unknown }> }> } | undefined;
  const responses = op?.responses ?? {};
  const key = String(status);
  const resKey = responses[key] ? key : responses[`${key[0]}XX`] ? `${key[0]}XX` : responses.default ? 'default' : undefined;
  if (!resKey) return { declared: false, issues: [{ location: 'response', path: '', message: `Status ${status} is not declared` }] };

  const content = responses[resKey]?.content ?? {};
  const media = Object.keys(content).find(isJsonMedia) ?? Object.keys(content)[0];
  const schemaPointer = media ? `/paths/${esc(pathTemplate)}/${method.toLowerCase()}/responses/${esc(resKey)}/content/${esc(media)}/schema` : undefined;
  if (!schemaPointer || body === undefined) return { declared: true, issues: [] };

  const validate = validatorFor(doc)(schemaPointer);
  if (!validate) return { declared: true, issues: [{ location: 'response', path: '', message: `Could not compile response schema at ${schemaPointer}` }] };
  if (validate(body)) return { declared: true, issues: [] };
  return {
    declared: true,
    issues: (validate.errors ?? []).map((e: ErrorObject) => ({
      location: 'response' as const,
      path: e.instancePath.replace(/^\//, '').replace(/\//g, '.'),
      message: e.message ?? 'invalid',
    })),
  };
}
