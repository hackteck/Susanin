<template>
  <ScrollArea as="main">
    <div :class="$style.page">
      <header :class="$style.head">
        <h1 :class="$style.title">{{ locale.t("appName") }}</h1>
        <p :class="$style.subtitle">{{ locale.t("tagline") }}</p>
      </header>

      <section v-for="section in sections" :key="section.heading" :class="$style.section">
        <h2 :class="$style.heading">{{ section.heading }}</h2>
        <p v-for="(paragraph, index) in section.body" :key="index" :class="$style.body">
          {{ paragraph }}
        </p>
      </section>

      <p :class="$style.credit">
        Map data ©
        <a href="https://www.openstreetmap.org/copyright" rel="noreferrer">OpenStreetMap</a>
        contributors.
      </p>
    </div>
  </ScrollArea>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { ScrollArea } from "@surstromming/scroll-area";
import { useLocale } from "@/stores/locale";

const locale = useLocale();

// Kept as data so the three languages sit side by side and none drifts.
const copy = {
  ru: [
    {
      heading: 'Что здесь показано',
      body: [
        '28 маршрутов Батуми, 578 остановок и все автобусы, которые сейчас на линии — данные обновляются каждые 5 секунд.',
        'Нажмите на остановку, чтобы увидеть расписание и примерное время прибытия.',
      ],
    },
    {
      heading: 'Откуда данные',
      body: [
        'Маршруты, остановки, расписания и координаты автобусов приходят из открытого в интернете сервиса данных о батумском транспорте. Это независимый проект: он не связан ни с мэрией Батуми, ни с «Батумским автотранспортом».',
        'Для Батуми не существует ни фида GTFS, ни официальных прогнозов прибытия. Время рассчитываем мы сами: измеряем, сколько автобусу осталось проехать по линии маршрута.',
      ],
    },
    {
      heading: 'Чего мы не обещаем',
      body: [
        'Расчётное время — не официальный прогноз. Расписание одно на все дни недели, потому что источник дни не разделяет.',
      ],
    },
  ],
  ka: [
    {
      heading: 'რას აჩვენებს',
      body: [
        'ბათუმის 28 მარშრუტი, 578 გაჩერება და ავტობუსების ცოცხალი მდებარეობა, რომელიც ყოველ 5 წამში ახლდება.',
        'გაჩერებაზე დაწკაპუნებით ნახავთ განრიგს და სავარაუდო მოსვლის დროს.',
      ],
    },
    {
      heading: 'საიდან მოდის მონაცემები',
      body: [
        'მარშრუტები, გაჩერებები, განრიგი და ავტობუსების კოორდინატები მოდის ბათუმის ტრანსპორტის მონაცემთა ღია სერვისიდან. ეს დამოუკიდებელი პროექტია და არ არის დაკავშირებული ბათუმის მერიასთან ან „ბათუმის ავტოტრანსპორტთან“.',
        'ბათუმისთვის GTFS არ არსებობს და ოფიციალური პროგნოზები არ ქვეყნდება — მოსვლის დროის შეფასებას ვითვლით ჩვენ, ავტობუსის მიმდინარე მდებარეობიდან მარშრუტის ხაზის გასწვრივ.',
      ],
    },
    {
      heading: 'რას არ გპირდებით',
      body: [
        'შეფასება არ არის ოფიციალური პროგნოზი. განრიგი ერთია ყოველი დღისთვის — წყარო კვირის დღეებს არ ჰყოფს.',
      ],
    },
  ],
  en: [
    {
      heading: 'What this shows',
      body: [
        "Batumi's 28 bus routes, 578 stops, and every bus currently running, refreshed every 5 seconds.",
        'Tap a stop for its timetable and for how long the next bus looks like taking.',
      ],
    },
    {
      heading: 'Where the data comes from',
      body: [
        'Routes, stops, timetables and live bus positions all come from a Batumi transit data service published on the internet. This is an independent project, not affiliated with Batumi City Hall or with Batumi Avtotransporti.',
        'There is no GTFS feed for Batumi and no published arrival predictions, so the estimates are ours — computed by measuring how far each bus still has to run along its route.',
      ],
    },
    {
      heading: 'What it does not promise',
      body: [
        'An estimate is not an official prediction. The timetable is one schedule for every day, because that is all the source distinguishes.',
      ],
    },
  ],
} as const;

const sections = computed(() => copy[locale.locale]);
</script>

<style module lang="scss">
@use "@surstromming/design" as design;

.page {
  display: flex;
  flex-direction: column;
  gap: design.spacing(6);
  max-width: design.spacing(170);
  margin: 0 auto;
  padding: design.spacing(6) design.spacing(4);
}

.head {
  display: flex;
  flex-direction: column;
  gap: design.spacing(1);
}

.title {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 600;
}

.subtitle {
  color: design.color(muted-foreground);
}

.section {
  display: flex;
  flex-direction: column;
  gap: design.spacing(2);
}

.heading {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
}

.body {
  color: design.color(muted-foreground);
  line-height: 1.6;
}

.credit {
  color: design.color(muted-foreground);
  font-size: 0.75rem;

  a {
    color: inherit;
  }
}
</style>
