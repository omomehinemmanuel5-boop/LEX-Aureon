import { permanentRedirect } from 'next/navigation';

export default function LandingRedirect() {
  permanentRedirect('/');
}
