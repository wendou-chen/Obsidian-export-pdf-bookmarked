export interface OutlineHeadingPositionLike {
  line?: number;
  offset?: number;
}

export interface OutlineHeadingLike {
  heading?: string;
  level?: number;
  position?: { start?: OutlineHeadingPositionLike };
}

export interface OutlineHeadingDomEntryLike<TDom = unknown> {
  selfEl?: TDom;
  coverEl?: TDom;
  heading?: OutlineHeadingLike;
}

export interface ResolvedOutlineHeadingIdentity {
  heading: string;
  level: number;
  startLine: number;
  startOffset: number;
  ordinal: number;
  sameHeadingIndex: number;
  sameHeadingCount: number;
}

export function resolveOutlineHeadingIdentityWithOptionalMetadata<TDom>(
  entries: OutlineHeadingDomEntryLike<TDom>[],
  metadataHeadings: OutlineHeadingLike[] | undefined,
  itemEl: TDom,
  fallbackIdentity?: Pick<OutlineHeadingLike, "heading" | "level">,
): ResolvedOutlineHeadingIdentity | null {
  return resolveOutlineHeadingIdentity(entries, metadataHeadings ?? [], itemEl, fallbackIdentity);
}

export function resolveOutlineHeadingIdentity<TDom>(
  entries: OutlineHeadingDomEntryLike<TDom>[],
  metadataHeadings: OutlineHeadingLike[],
  itemEl: TDom,
  fallbackIdentity?: Pick<OutlineHeadingLike, "heading" | "level">,
): ResolvedOutlineHeadingIdentity | null {
  const domMatches = entries
    .map((entry, ordinal) => ({ entry, ordinal }))
    .filter(({ entry }) => entry.selfEl === itemEl || entry.coverEl === itemEl);
  if (domMatches.length === 1) {
    const { entry, ordinal } = domMatches[0];
    const validated = validateHeading(entry.heading);
    if (validated) {
      const sameEntries = entries.filter((candidate) =>
      candidate.heading?.heading === validated.heading && candidate.heading?.level === validated.level);
    const sameHeadingIndex = entries.slice(0, ordinal).filter((candidate) =>
      candidate.heading?.heading === validated.heading && candidate.heading?.level === validated.level).length;
      return { ...validated, ordinal, sameHeadingIndex, sameHeadingCount: sameEntries.length };
    }
  }
  if (domMatches.length > 1 || typeof fallbackIdentity?.heading !== "string") return null;

  const metadataMatches = metadataHeadings
    .map((heading, ordinal) => ({ heading, ordinal, validated: validateHeading(heading) }))
    .filter(({ heading, validated }) => validated && heading.heading === fallbackIdentity.heading &&
      (fallbackIdentity.level === undefined || heading.level === fallbackIdentity.level));
  if (metadataMatches.length !== 1) return null;
  const match = metadataMatches[0];
  const validated = match.validated as Omit<ResolvedOutlineHeadingIdentity, "ordinal" | "sameHeadingIndex" | "sameHeadingCount">;
  const same = metadataHeadings.filter((heading) =>
    heading.heading === validated.heading && heading.level === validated.level);
  const sameHeadingIndex = metadataHeadings.slice(0, match.ordinal).filter((heading) =>
    heading.heading === validated.heading && heading.level === validated.level).length;
  return { ...validated, ordinal: match.ordinal, sameHeadingIndex, sameHeadingCount: same.length };
}

function validateHeading(heading: OutlineHeadingLike | undefined):
  Omit<ResolvedOutlineHeadingIdentity, "ordinal" | "sameHeadingIndex" | "sameHeadingCount"> | null {
  const level = heading?.level;
  const startLine = heading?.position?.start?.line;
  const startOffset = heading?.position?.start?.offset;
  if (!heading || typeof heading.heading !== "string" || typeof level !== "number" ||
    !Number.isInteger(level) || typeof startLine !== "number" || !Number.isInteger(startLine) ||
    typeof startOffset !== "number" || !Number.isInteger(startOffset)) return null;
  return { heading: heading.heading, level, startLine, startOffset };
}
