import { Container, Section } from "@/components/shared/container";
import { Display, Lead, Overline } from "@/components/shared/typography";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import type { FaqItem } from "@/types/content";

export interface FaqProps {
  items: FaqItem[];
  supportHref: string;
}

export function Faq({ items, supportHref }: FaqProps) {
  return (
    <Section aria-labelledby="faq-title">
      <Container>
        <div className="grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <Overline>Questions</Overline>
            <Display id="faq-title" size="lg" className="mt-4">
              Before you start
            </Display>
            <Lead size="md" className="mt-5">
              Something else on your mind?{" "}
              <a href={supportHref} className="text-gold-700 underline underline-offset-4 hover:text-ink-900">
                Talk to us
              </a>
              .
            </Lead>
          </div>
          <Accordion type="single" collapsible className="border-t border-ink-200 lg:col-span-8">
            {items.map((item, i) => (
              <AccordionItem key={item.question} value={`faq-${i}`}>
                <AccordionTrigger>{item.question}</AccordionTrigger>
                <AccordionContent>{item.answer}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </Container>
    </Section>
  );
}
