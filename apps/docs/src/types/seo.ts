export interface SchemaBreadcrumbItem {
  name: string;
  url: string;
}

export interface SchemaAuthor {
  name: string;
  url?: string;
}

export interface TechArticleParams {
  title: string;
  description: string;
  url: string;
  keywords?: string[];
  datePublished?: string;
  dateModified?: string;
  author?: SchemaAuthor;
  breadcrumbs?: SchemaBreadcrumbItem[];
}

export interface SoftwareAppParams {
  name: string;
  description: string;
  url: string;
  applicationCategory: string;
  operatingSystem: string;
  programmingLanguage: string[];
  codeRepository: string;
  keywords: string[];
  version: string;
  license: string;
  author: SchemaAuthor;
}

export interface BlogPostingParams {
  title: string;
  description: string;
  url: string;
  image?: string;
  datePublished: string;
  dateModified?: string;
  author: SchemaAuthor;
  tags?: string[];
  breadcrumbs?: SchemaBreadcrumbItem[];
}

export interface BreadcrumbListJsonLd {
  "@context": "https://schema.org";
  "@type": "BreadcrumbList";
  itemListElement: Array<{
    "@type": "ListItem";
    position: number;
    name: string;
    item: string;
  }>;
}

export interface TechArticleJsonLd {
  "@context": "https://schema.org";
  "@type": "TechArticle";
  headline: string;
  description: string;
  url: string;
  mainEntityOfPage: {
    "@type": "WebPage";
    "@id": string;
  };
  keywords?: string;
  inLanguage: string;
  datePublished?: string;
  dateModified?: string;
  author: {
    "@type": "Person" | "Organization";
    name: string;
    url?: string;
  };
  publisher: {
    "@type": "Person" | "Organization";
    name: string;
    url?: string;
  };
  isPartOf: {
    "@type": "WebSite";
    name: string;
    url: string;
  };
}

export interface SoftwareApplicationJsonLd {
  "@context": "https://schema.org";
  "@type": ["SoftwareApplication", "SoftwareSourceCode"];
  name: string;
  description: string;
  url: string;
  applicationCategory: string;
  operatingSystem: string;
  offers: {
    "@type": "Offer";
    price: string;
    priceCurrency: string;
  };
  softwareVersion: string;
  license: string;
  author: {
    "@type": "Person";
    name: string;
    url?: string;
  };
  codeRepository: string;
  programmingLanguage: string[];
  keywords: string[];
}

export interface BlogPostingJsonLd {
  "@context": "https://schema.org";
  "@type": "BlogPosting";
  headline: string;
  description: string;
  url: string;
  image?: string;
  mainEntityOfPage: {
    "@type": "WebPage";
    "@id": string;
  };
  datePublished: string;
  dateModified: string;
  author: {
    "@type": "Person";
    name: string;
    url?: string;
  };
  publisher: {
    "@type": "Person";
    name: string;
    url?: string;
  };
  keywords?: string;
  inLanguage: string;
  isPartOf: {
    "@type": "WebSite";
    name: string;
    url: string;
  };
}
