import Link from "next/link";

export const metadata = {
  title: "Privacy Policy",
};

const CONTACT_EMAIL = "tranmykaraoke@gmail.com";

export default function PrivacyPolicyPage() {
  return (
    <article className="container prose mx-auto p-6 lg:prose-xl bg-slate-100 sm:my-8 rounded-lg shadow-lg">
      <h1>Privacy Policy</h1>
      <p>
        <em>Last updated: November 15, 2026</em>
      </p>

      <p>
        This Privacy Policy explains what information &quot;My Karaoke
        Party&quot; (the &quot;App&quot;) collects, how it is used, and the
        choices you have. The App is run by the operator of My Karaoke Party
        (&quot;we&quot;, &quot;us&quot;). The App does not have user accounts,
        does not show ads, and does not sell or rent your information to
        anyone.
      </p>

      <h2>Information We Collect</h2>

      <h3>Information you enter</h3>
      <ul>
        <li>
          <strong>Party name.</strong> When you host a party, the name you give
          it is stored in our database together with a party code and the date
          it was created.
        </li>
        <li>
          <strong>Singer name and song queue.</strong> When you join a party,
          the name you enter is shown to everyone in that party next to the
          songs you add. The queue (song title, thumbnail, duration, singer
          name and when it was added or played) is stored on our realtime
          server so that every screen in the party stays in sync.
        </li>
        <li>
          <strong>Search terms.</strong> When you search for a song, your
          search text is sent to the YouTube Data API to find matching videos.
        </li>
      </ul>
      <p>
        Please do not enter sensitive personal information (such as your full
        name, address or phone number) as a party or singer name. A first name
        or nickname is all the App needs.
      </p>

      <h3>Information stored in your browser</h3>
      <p>
        The App remembers the singer name you last used in your browser&apos;s
        local storage, so you don&apos;t have to type it again. It stays on
        your device and you can remove it by clearing your browser&apos;s site
        data. The App itself does not set advertising or tracking cookies.
      </p>

      <h3>Information collected automatically</h3>
      <ul>
        <li>
          <strong>Server logs.</strong> Like most websites, our hosting
          providers process technical information such as your IP address,
          browser type and the pages requested, in order to deliver the App and
          protect it from abuse. Our logs also record party names and search
          terms to help us fix problems. Logs are kept only for a short period.
        </li>
        <li>
          <strong>Usage statistics.</strong> We may use Vercel Web Analytics
          and Speed Insights to understand how many people visit the App and
          how fast it loads. These tools do not use cookies and report
          aggregated statistics, such as page views, country, browser and
          device type. They are not used to identify you.
        </li>
      </ul>

      <h2>YouTube API Services</h2>
      <p>
        The App uses YouTube API Services to search for videos, and plays
        videos using YouTube&apos;s embedded player. By using the App you also
        agree to be bound by the{" "}
        <a
          href="https://www.youtube.com/t/terms"
          target="_blank"
          rel="noopener noreferrer"
        >
          YouTube Terms of Service
        </a>
        . Information sent to YouTube, including your search terms and any
        data collected by the embedded player (which may set its own cookies),
        is handled by Google under the{" "}
        <a
          href="https://policies.google.com/privacy"
          target="_blank"
          rel="noopener noreferrer"
        >
          Google Privacy Policy
        </a>
        .
      </p>
      <p>
        The App does not ask you to sign in to Google or YouTube and does not
        access, store or use any data from your Google or YouTube account.
      </p>

      <h2>How We Use Information</h2>
      <p>We use the information described above only to:</p>
      <ul>
        <li>create and run karaoke parties and keep their song queues in sync;</li>
        <li>show search results from YouTube;</li>
        <li>
          cache search results so that repeated searches don&apos;t use up our
          YouTube quota; and
        </li>
        <li>keep the App working, secure and free from abuse.</li>
      </ul>

      <h2>How Long We Keep Information</h2>
      <ul>
        <li>
          <strong>Song queues and singer names</strong> are deleted
          automatically 30 days after a party was last used.
        </li>
        <li>
          <strong>Cached YouTube search results</strong> (search text and the
          video titles and thumbnails found) are deleted automatically after 24
          hours.
        </li>
        <li>
          <strong>Party names</strong> are kept in our database until you ask
          us to delete them.
        </li>
        <li>
          <strong>Server logs</strong> are kept for a short period by our
          hosting providers and then deleted automatically.
        </li>
      </ul>

      <h2>Service Providers</h2>
      <p>
        We use the following providers to run the App. They process
        information only to provide their services to us:
      </p>
      <ul>
        <li>
          <strong>Vercel</strong>: website hosting, server logs and usage
          statistics.
        </li>
        <li>
          <strong>Cloudflare</strong>: realtime server that stores party song
          queues.
        </li>
        <li>
          <strong>Neon</strong>: database that stores party names.
        </li>
        <li>
          <strong>Upstash</strong>: cache for YouTube search results.
        </li>
        <li>
          <strong>Google (YouTube)</strong>: video search and playback.
        </li>
      </ul>
      <p>
        We do not share your information with anyone else, except where
        required by law.
      </p>

      <h2>Your Choices and Rights</h2>
      <p>
        You can ask us to delete a party (its name and song queue) at any time
        by emailing us with the party code. You can also contact us to ask what
        information we hold about you or to correct it. Because the App has no
        accounts, we may ask for the party code or other details to find the
        right information.
      </p>

      <h2>Children</h2>
      <p>
        The App is not directed to children under 13, and we do not knowingly
        collect personal information from them. If you believe a child has
        entered personal information, please contact us and we will delete
        it.
      </p>

      <h2>Changes to This Policy</h2>
      <p>
        We may update this Privacy Policy from time to time. Changes take
        effect when they are posted on this page, and the &quot;Last
        updated&quot; date above will change.
      </p>

      <h2>Contact</h2>
      <p>
        Questions or requests about this Privacy Policy can be sent to{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>

      <p>
        <Link href="/terms-of-service">Terms of Service</Link>
        {" · "}
        <Link href="/">Back to Home</Link>
      </p>
    </article>
  );
}
