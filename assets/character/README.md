# Qmanyity 캐릭터 레이어 규칙

기본 캐릭터와 모든 표정/코스튬 PNG는 **692 x 638 px** 캔버스를 사용합니다.
코스튬 파일은 배경을 투명하게 만들고, 기본 캐릭터와 같은 위치에 그리면 웹에서 자동으로 정확히 겹쳐집니다.

## 레이어 순서

아래에서 위 순서입니다.

1. `back` - 캐릭터 뒤쪽 장식 (망토 뒤, 날개 등)
2. `base` - 얼굴이 없는 기본 캐릭터 몸
3. `body` - 옷, 목도리 등 몸에 입는 코스튬
4. `expression` - 눈, 입, 볼 등 표정
5. `face` - 안경, 마스크 등 얼굴 장식
6. `head` - 모자, 머리띠 등 머리 장식
7. `front` - 캐릭터 전체 앞에 나오는 장식

## 현재 파일

- `base.png` : 기본 캐릭터 몸. 표정은 분리되어 있음.
- `expressions/default.png` : 현재 기본 표정.

## 나중에 파일을 추가하는 예시

```text
assets/character/
├─ base.png
├─ expressions/
│  ├─ default.png
│  ├─ happy.png
│  ├─ sad.png
│  └─ angry.png
├─ body/
│  ├─ blue-shirt.png
│  └─ hoodie.png
├─ face/
│  └─ glasses.png
├─ head/
│  ├─ cap.png
│  └─ crown.png
├─ back/
│  └─ wings.png
└─ front/
   └─ sparkles.png
```

사용자의 장착 상태를 나중에 서버에서 다음 형태로 내려주면 현재 `index.html`의 레이어 시스템이 바로 표시할 수 있습니다.

```js
currentUser.character = {
  expression: "/assets/character/expressions/happy.png",
  body: "/assets/character/body/hoodie.png",
  face: "/assets/character/face/glasses.png",
  head: "/assets/character/head/cap.png",
  back: null,
  front: null
};
```

표정은 `base.png`에 직접 그리지 않고 `expression` PNG로 관리하는 것이 중요합니다. 그래야 표정을 바꿀 때 기본 캐릭터 몸을 다시 만들 필요가 없습니다.
