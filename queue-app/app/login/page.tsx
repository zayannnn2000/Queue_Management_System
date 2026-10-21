import type { Metadata } from "next";
import { Suspense } from "react";
import { PinLogin } from "@/components/pin-login";

export const metadata: Metadata = { title: "Staff sign-in" };

export default function LoginPage() {
  return (
    <Suspense>
      <PinLogin />
    </Suspense>
  );
}
