import data from '@/framer/data.json';
import { FramerSite, type SiteData } from '@/framer/runtime';

export default function Home() {
  return <FramerSite data={data as unknown as SiteData} />;
}
