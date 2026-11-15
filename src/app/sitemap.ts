import type { MetadataRoute } from "next";
import { getUrl } from "~/utils/url";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", "/terms-of-service", "/privacy-policy"].map((path) => ({
    url: getUrl(path),
    lastModified: new Date(),
    changeFrequency: "monthly",
    priority: path === "/" ? 1 : 0.5,
  }));
}
