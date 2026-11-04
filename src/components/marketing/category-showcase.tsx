import { Container, Section } from "@/components/shared/container";
import { DemoImage } from "@/components/shared/demo-image";
import { Display, Lead, Overline } from "@/components/shared/typography";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { DemoImage as DemoImageData } from "@/types/content";

export interface CategoryShowcaseProps {
  categories: { id: string; label: string; images: DemoImageData[] }[];
}

/** Category tabs with a 3-up image grid (stacks to 2 columns on phones). */
export function CategoryShowcase({ categories }: CategoryShowcaseProps) {
  const first = categories[0];
  if (!first) return null;

  return (
    <Section aria-labelledby="category-title">
      <Container>
        <div className="max-w-2xl">
          <Overline>Every category</Overline>
          <Display id="category-title" className="mt-4">
            Made for Indian jewellery, not generic products
          </Display>
          <Lead className="mt-5">
            From temple bangles to solitaires, every style asks the image service to keep metal tone, stones and fine
            detail unchanged, and you check each result against your original before using it.
          </Lead>
        </div>
        <Tabs defaultValue={first.id} className="mt-12">
          <TabsList aria-label="Jewellery categories">
            {categories.map((c) => (
              <TabsTrigger key={c.id} value={c.id}>
                {c.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {categories.map((c) => (
            <TabsContent key={c.id} value={c.id}>
              <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-6">
                {c.images.map((image, i) => (
                  <li key={`${c.id}-${image.id}`} className={i > 1 ? "hidden md:block" : undefined}>
                    <DemoImage image={image} aspect="1 / 1" sizes="(min-width: 768px) 33vw, 50vw" />
                  </li>
                ))}
              </ul>
            </TabsContent>
          ))}
        </Tabs>
      </Container>
    </Section>
  );
}
