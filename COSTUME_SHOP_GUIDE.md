# Qmanyity 코스튬 상점

## 현재 테스트 모드

`lib/costume.js`의 설정은 다음과 같습니다.

```js
export const COSTUME_SHOP_CONFIG = Object.freeze({
  mode: "TEST_FREE",
  costumeVersion: 1,
  currencyName: "점수"
});
```

TEST_FREE에서는 사용자가 점수를 소비하지 않고 등록된 모든 코스튬을 바로 장착할 수 있습니다.

## 코스튬 추가

`assets/character/<레이어>/`에 기본 캐릭터와 같은 692x638 크기의 투명 PNG를 넣고 `lib/costume.js`의 `COSTUME_ITEMS`에 항목을 추가합니다.

지원 레이어:
- back
- body
- expression
- face
- head
- front

## 나중에 점수 구매를 시작할 때

1. 각 코스튬의 `price`를 숫자로 지정합니다.
2. `mode`를 `"PAID"`로 변경합니다.
3. `costumeVersion`을 `2`로 올립니다.

예시:

```js
export const COSTUME_SHOP_CONFIG = Object.freeze({
  mode: "PAID",
  costumeVersion: 2,
  currencyName: "점수"
});
```

`costumeVersion`이 바뀌면 테스트 기간에 장착했던 코스튬은 공개 화면에서도 즉시 기본 캐릭터 상태로 처리됩니다. 사용자가 상점을 다시 열면 DB의 테스트 장착 상태와 테스트 인벤토리도 새 버전에 맞춰 초기화됩니다.

PAID 모드에서는 `purchase` API가 사용자의 `point`를 확인해 가격만큼 차감하고 `costumeInventory`에 구매한 코스튬 ID를 저장합니다. 구매한 코스튬만 장착할 수 있습니다.
