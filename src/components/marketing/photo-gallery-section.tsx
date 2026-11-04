import { Container, Section } from "@/components/shared/container";
import { Display, Lead, Overline } from "@/components/shared/typography";
import type { StylePreview } from "@/content/style-previews";

import { StyleGallery } from "./style-gallery";

/** Homepage gallery of jewellery photographs, each in its own frame, with a larger preview on click. */
export function PhotoGallerySection({ photos }: { photos: StylePreview[] }) {
  return (
    <Section aria-labelledby="photo-gallery-title" id="gallery">
      <Container>
        <div className="max-w-2xl">
          <Overline>Photography gallery</Overline>
          <Display id="photo-gallery-title" className="mt-4">
            Explore Our Jewellery Photography Styles
          </Display>
          <Lead className="mt-5">
            Discover beautiful jewellery photography styles and premium catalogue looks for your jewellery collection.
          </Lead>
        </div>
        <div className="mt-10 lg:mt-12">
          <StyleGallery previews={photos} filters={false} />
        </div>
      </Container>
    </Section>
  );
}
