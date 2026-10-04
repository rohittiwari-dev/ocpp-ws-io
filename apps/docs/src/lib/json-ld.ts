import type {
  BlogPostingJsonLd,
  BlogPostingParams,
  BreadcrumbListJsonLd,
  SchemaAuthor,
  SchemaBreadcrumbItem,
  SoftwareApplicationJsonLd,
  SoftwareAppParams,
  TechArticleJsonLd,
  TechArticleParams,
} from "@/types/seo";

const BASE_URL = "https://ocpp-ws-io.rohittiwari.me";
const DEFAULT_AUTHOR: SchemaAuthor = {
  name: "Rohit Tiwari",
  url: "https://rohittiwari.me",
};

/**
 * Creates Schema.org BreadcrumbList JSON-LD
 */
export function createBreadcrumbJsonLd(
  items: SchemaBreadcrumbItem[],
): BreadcrumbListJsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url.startsWith("http") ? item.url : `${BASE_URL}${item.url}`,
    })),
  };
}

/**
 * Creates Schema.org TechArticle JSON-LD for technical documentation pages
 */
export function createTechArticleJsonLd(
  params: TechArticleParams,
): TechArticleJsonLd {
  const author = params.author || DEFAULT_AUTHOR;
  const canonicalUrl = params.url.startsWith("http")
    ? params.url
    : `${BASE_URL}${params.url}`;

  return {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: params.title,
    description: params.description,
    url: canonicalUrl,
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": canonicalUrl,
    },
    ...(params.keywords && params.keywords.length > 0
      ? { keywords: params.keywords.join(", ") }
      : {}),
    inLanguage: "en-US",
    ...(params.datePublished ? { datePublished: params.datePublished } : {}),
    ...(params.dateModified ? { dateModified: params.dateModified } : {}),
    author: {
      "@type": "Person",
      name: author.name,
      ...(author.url ? { url: author.url } : {}),
    },
    publisher: {
      "@type": "Person",
      name: DEFAULT_AUTHOR.name,
      url: DEFAULT_AUTHOR.url,
    },
    isPartOf: {
      "@type": "WebSite",
      name: "OCPP WS IO",
      url: BASE_URL,
    },
  };
}

/**
 * Creates Schema.org SoftwareApplication JSON-LD for developer toolkits & ecosystems
 */
export function createSoftwareApplicationJsonLd(
  params: SoftwareAppParams,
): SoftwareApplicationJsonLd {
  return {
    "@context": "https://schema.org",
    "@type": ["SoftwareApplication", "SoftwareSourceCode"],
    name: params.name,
    description: params.description,
    url: params.url,
    applicationCategory: params.applicationCategory,
    operatingSystem: params.operatingSystem,
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    softwareVersion: params.version,
    license: params.license,
    author: {
      "@type": "Person",
      name: params.author.name,
      ...(params.author.url ? { url: params.author.url } : {}),
    },
    codeRepository: params.codeRepository,
    programmingLanguage: params.programmingLanguage,
    keywords: params.keywords,
  };
}

/**
 * Creates Schema.org BlogPosting JSON-LD for engineering articles and tutorials
 */
export function createBlogPostingJsonLd(
  params: BlogPostingParams,
): BlogPostingJsonLd {
  const canonicalUrl = params.url.startsWith("http")
    ? params.url
    : `${BASE_URL}${params.url}`;

  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: params.title,
    description: params.description,
    url: canonicalUrl,
    ...(params.image ? { image: params.image } : {}),
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": canonicalUrl,
    },
    datePublished: params.datePublished,
    dateModified: params.dateModified || params.datePublished,
    author: {
      "@type": "Person",
      name: params.author.name,
      ...(params.author.url ? { url: params.author.url } : {}),
    },
    publisher: {
      "@type": "Person",
      name: DEFAULT_AUTHOR.name,
      url: DEFAULT_AUTHOR.url,
    },
    ...(params.tags && params.tags.length > 0
      ? { keywords: params.tags.join(", ") }
      : {}),
    inLanguage: "en-US",
    isPartOf: {
      "@type": "WebSite",
      name: "OCPP WS IO",
      url: BASE_URL,
    },
  };
}

/** Escape HTML delimiters before embedding JSON-LD in a script element. */
export function serializeJsonLd<T extends object>(value: T): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
