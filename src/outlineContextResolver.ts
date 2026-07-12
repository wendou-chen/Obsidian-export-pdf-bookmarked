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
}

export function resolveOutlineHeadingIdentity<TDom>(
  entries: OutlineHeadingDomEntryLike<TDom>[],
  metadataHeadings: OutlineHeadingLike[],
  itemEl: TDom,
): ResolvedOutlineHeadingIdentity | null {
  const domMatches = entries.filter((entry) => entry.selfEl === itemEl || entry.coverEl === itemEl);
  if (domMatches.length !== 1) return null;

  const heading = domMatches[0].heading;
  const level = heading?.level;
  const startLine = heading?.position?.start?.line;
  const startOffset = heading?.position?.start?.offset;
  if (
    !heading || typeof heading.heading !== "string" ||
    typeof level !== "number" || !Number.isInteger(level) ||
    typeof startLine !== "number" || !Number.isInteger(startLine) ||
    typeof startOffset !== "number" || !Number.isInteger(startOffset)
  ) return null;

  const metadataMatches = metadataHeadings
    .map((candidate, ordinal) => ({ candidate, ordinal }))
    .filter(({ candidate }) => candidate.position?.start?.offset === startOffset);
  if (metadataMatches.length !== 1) return null;

  return { heading: heading.heading, level, startLine, startOffset, ordinal: metadataMatches[0].ordinal };
}
