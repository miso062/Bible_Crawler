import axios from "axios";
import * as cheerio from "cheerio";
import { BIBLE_BOOKS } from "./bible-books.js";
import fs from "fs";

// 기본 URL
const BASE_URL = "https://nocr.net";

// 지정된 시간만큼 대기하는 딜레이 함수
function delay(ms) {
  // Promise를 반환하여 비동기적으로 지정된 시간(ms)만큼 대기
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 지정된 경로의 웹페이지 HTML을 가져오는 함수
async function fetchPage(route) {
  try {
    // axios를 사용하여 BASE_URL과 route를 결합한 URL로 GET 요청
    const response = await axios.get(`${BASE_URL}${route}`, {
      headers: {
        // 브라우저처럼 보이도록 User-Agent 설정
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        // Accept 헤더로 HTML 형식 요청
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        // 언어 설정
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
        // Referer 헤더로 출처 명시
        Referer: BASE_URL,
      },
    });

    // 응답 데이터(HTML) 반환
    return response.data;
  } catch (error) {
    // 에러 발생 시 에러 메시지 출력 후 에러 재발생
    console.error(`페이지 가져오기 실패: ${route}`, error.message);
    throw error;
  }
}

// HTML에서 장(Chapter) 링크들을 추출하는 함수
function getChapterLinks(html) {
  // cheerio를 사용하여 HTML을 파싱
  const $ = cheerio.load(html);

  // tbody 내부의 .title 클래스를 가진 a 태그들을 선택하여 href 속성 추출
  const hrefs = $("tbody .title a")
    .map((i, el) => $(el).attr("href"))
    .get();

  // 추출된 링크 배열 반환
  return hrefs;
}

// 특정 장 페이지에서 성경 본문 텍스트를 추출하는 함수
async function getChapterText(link) {
  // 링크로부터 HTML 페이지 가져오기
  const html = await fetchPage(link);
  // cheerio로 HTML 파싱
  const $ = cheerio.load(html);
  // .rhymix_content 클래스를 가진 요소의 텍스트 추출
  const text = $(".rhymix_content").text();

  // 추출된 텍스트 반환
  return text;
}

// 장 텍스트를 절(Verse) 단위로 파싱하여 구조화된 데이터로 반환하는 함수
function parseVerses(chapterText) {
  // 정규식으로 "장:절" 패턴 찾기 (예: "1:1", "2:15")
  const versePattern = /(\d+):(\d+)/g;

  // 절 정보를 담을 배열 초기화
  const verses = [];
  // 텍스트에서 모든 절 번호 패턴 찾기
  const matches = [...chapterText.matchAll(versePattern)];
  // 첫 번째 매치에서 장 번호 추출
  const chapterNum = matches[0][1];

  // 매치가 없으면 빈 배열 반환
  if (matches.length === 0) return verses;

  // 각 절 번호를 순회하며 절 텍스트 추출
  matches.forEach((el, i) => {
    // 정규식 매치에서 장 번호 추출
    const chapterNum = el[1];
    // 정규식 매치에서 절 번호 추출
    const verseNum = el[2];

    // 절 텍스트가 시작되는 위치 계산 (절 번호 다음 위치)
    const verseStartIndex = el.index + el[0].length;
    // 절 텍스트가 끝나는 위치 계산
    const verseEndIndex =
      i < matches.length - 1
        ? matches[i + 1].index // 다음 절 번호가 있으면 그 위치까지
        : chapterText.length; // 마지막 절이면 텍스트 끝까지
    // 시작과 끝 인덱스 사이의 텍스트 추출 후 공백 제거
    const verse = chapterText.substring(verseStartIndex, verseEndIndex).trim();

    // 절 정보 객체를 배열에 추가
    verses.push({
      chapterNum,
      verseNum,
      verse,
    });
  });

  // 장 번호와 절 배열을 포함한 객체 생성
  const returnData = {
    chapterNum,
    verses,
  };

  // 파싱된 데이터 반환
  return returnData;
}

// 특정 장 링크로부터 장의 모든 절 데이터를 가져오는 함수
async function getChapterData(link) {
  // 링크로부터 장의 전체 텍스트 추출
  const chapterText = await getChapterText(link);

  // 텍스트를 절 단위로 파싱하여 구조화된 데이터로 변환
  const chapterData = parseVerses(chapterText);

  // 파싱된 장 데이터 반환
  return chapterData;
}

// 특정 책의 모든 장 데이터를 크롤링하여 반환하는 함수
async function getBookDatas(bookName) {
  // BIBLE_BOOKS에서 책 정보 가져오기
  const bookData = BIBLE_BOOKS[bookName];
  // 책의 카테고리 번호를 사용하여 크롤링 대상 URL 생성
  const targetUrl = `/korsms/category/${bookData.categoryNumber}`;

  // 책 이름 출력
  console.log(`========== ${bookName} 크롤링 시작 ==========`);

  // 책 목록 페이지의 HTML 가져오기
  const html = await fetchPage(targetUrl);

  // HTML에서 모든 장 링크 추출
  const chapterLinks = getChapterLinks(html);

  // 장 데이터를 저장할 배열 초기화
  const chapterDatas = [];

  // 순차적으로 처리하여 서버 부하 방지 및 차단 방지
  for (let i = 0; i < chapterLinks.length; i++) {
    try {
      // 첫 번째 요청이 아닌 경우 1초 딜레이로 서버 부하 방지
      if (i > 0) {
        await delay(1000);
      }

      // 각 장 링크로부터 장 데이터 추출
      const chapterData = await getChapterData(chapterLinks[i]);
      // 추출된 장 데이터를 배열에 추가
      chapterDatas.push(chapterData);
      // 진행 상황 출력
      console.log(`${i + 1}장 완료`);
    } catch (error) {
      // 에러 발생 시 에러 메시지 출력
      console.log(`${i + 1}장 오류 발생`);
      // 에러 발생 시 2초 딜레이 후 다음 장으로 진행
      await delay(2000);
    }
  }

  // 모든 장 데이터 반환
  return chapterDatas;
}

// 성경의 모든 책 데이터를 크롤링하여 구조화된 형태로 반환하는 함수
async function getBibleDatas() {
  // BIBLE_BOOKS에서 모든 책 이름 배열 가져오기
  const bookNames = Object.keys(BIBLE_BOOKS);
  // 최종 결과를 저장할 배열 초기화
  const bibleDatas = [];

  // 각 책을 순회하며 데이터 수집
  for (let i = 0; i < bookNames.length; i++) {
    // 현재 처리 중인 책 이름
    const bookName = bookNames[i];
    // 책의 메타 정보 가져오기
    const bookInfo = BIBLE_BOOKS[bookName];
    // 책의 모든 장 데이터 크롤링
    const chapters = await getBookDatas(bookName);

    // 책 정보와 장 데이터를 결합하여 결과 배열에 추가
    bibleDatas.push({
      korean: bookInfo.korean,
      english: bookInfo.english,
      testament: bookInfo.testament,
      categoryNumber: bookInfo.categoryNumber,
      chapters: chapters,
    });
  }

  // 모든 책 데이터 반환
  return bibleDatas;
}

// 메인 실행 함수: 성경 전체 데이터를 크롤링하고 파일로 저장
async function main() {
  try {
    // 성경의 모든 책 데이터 크롤링
    const bibleDatas = await getBibleDatas();

    // 크롤링한 데이터를 JSON 파일로 저장 (들여쓰기 2칸으로 포맷팅)
    fs.writeFileSync("bible.json", JSON.stringify(bibleDatas, null, 2));
  } catch (error) {
    // 에러 발생 시 에러 메시지 출력 후 에러 재발생
    console.error("실행 중 오류 발생:", error);
    throw error;
  }
}

// 스크립트 실행
main();
