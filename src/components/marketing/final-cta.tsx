import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Container } from "@/components/shared/container";
import { Display, GoldRule, Lead } from "@/components/shared/typography";
import { Button } from "@/components/ui/button";

export interface FinalCtaProps {
  title: string;
  body: string;
  cta: { label: string; href: string };
}

export function FinalCta({ title, body, cta }: FinalCtaProps) {
  return (
    <section aria-labelledby="final-cta-title" className="border-t border-ink-200 bg-canvas py-20 lg:py-28">
      <Container width="narrow" className="flex flex-col items-center text-center">
        <GoldRule />
        <Display id="final-cta-title" className="mt-8">
          {title}
        </Display>
        <Lead className="mt-5 max-w-lg">{body}</Lead>
        <Button asChild size="lg" className="mt-10">
          <Link href={cta.href}>
            {cta.label}
            <ArrowRight aria-hidden />
          </Link>
        </Button>
      </Container>
    </section>
  );
}
