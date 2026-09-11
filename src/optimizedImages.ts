import variants from "./optimizedImages.json";

// Exact source matching keeps newly selected CMS images working without stale previews.
export function optimizedImage(source: string) {
  return (variants as Record<string, { src: string; srcSet: string }>)[source] ?? { src: source };
}
