import { Reveal } from "@/components/motion/reveal";
import { Container, Section } from "@/components/shared/container";
import { DemoImage } from "@/components/shared/demo-image";
import { Display, GoldRule, Heading, Lead, Overline } from "@/components/shared/typography";
import type { FeatureStep } from "@/types/content";

export interface HowItWorksProps {
  steps: FeatureStep[];
}

export function HowItWorks({ steps }: HowItWorksProps) {
  return (
    <Section id="how-it-works" aria-labelledby="how-title">
      <Container>
        <div className="max-w-2xl">
          <Overline>How it works</Overline>
          <Display id="how-title" className="mt-4">
            Three steps from counter to catalogue
          </Display>
          <Lead className="mt-5">No studio, no lightbox, no editing software — just the phone already in your pocket.</Lead>
        </div>
        <ol className="mt-14 grid gap-12 md:grid-cols-3 md:gap-8 lg:mt-20">
          {steps.map((step, i) => (
            <li key={step.number}>
              <Reveal delay={i * 0.08}>
                <DemoImage image={step.image} aspect="4 / 5" sizes="(min-width: 768px) 33vw, 100vw" />
                <div className="mt-6 flex items-baseline gap-4">
                  <span className="font-serif text-display-sm text-gold-500 tabular" aria-hidden>
                    {step.number}
                  </span>
                  <Heading size="md">
                    <span className="sr-only">Step {i + 1}: </span>
                    {step.title}
                  </Heading>
                </div>
                <GoldRule className="mt-4" />
                <p className="mt-4 text-body text-ink-600">{step.body}</p>
              </Reveal>
            </li>
          ))}
        </ol>
      </Container>
    </Section>
  );
}
