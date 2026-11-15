# 원본 표의 셀 관계

`handbook-2026-2-p53.tables.json`은 2026-2 편람 PDF 53쪽의 균형교양 표를 구조화한 채점 자료입니다. 표 전체의 18행·5열과 실제 셀 50개를 담았습니다. 병합된 영역·제외 계열 셀의 범위를 보존해서 과목·학점의 연결을 확인합니다. 질문별 정답이나 모델 응답을 저장한 파일은 아닙니다.

원문 PDF 해시는 `1d1063aead628b4a5bcd9a8a261f28498b23bb060aeb0cc564dc1d157c7e3f10`입니다. 판본·해시·페이지가 다르면 재사용하지 않습니다. 이 자료는 기존 평가셋 v1 밖에 두었으며, 112건 릴리스와 정답지의 내용은 바꾸지 않았습니다.

## 어떻게 만들었는가

PDF의 선 경계로 찾은 셀 좌표에서 행·열과 병합 범위를 계산했습니다. `pdfplumber 0.11.9`의 `find_tables()`·`cells`·`extract()`를 사용했고, AI가 PDF 53쪽 이미지와 추출 결과를 대조했습니다. 사람 검토는 아직 받지 않았습니다. 이 상태를 파일의 provenance에 그대로 표시했습니다. [pdfplumber 표 추출 명세](https://github.com/jsvine/pdfplumber#extracting-tables)

추출은 자료를 준비할 때만 수행합니다. 평가와 재검사는 TypeScript로 동작하며 Python이나 PDF 추출 라이브러리를 실행하지 않습니다. 다른 판본·표를 추가하려면 다음 방식으로 경계를 추출하고, 원본 이미지에서 병합 범위와 열 역할을 다시 확인해야 합니다.

```python
import pdfplumber

with pdfplumber.open("handbook-2026-2.pdf") as doc:
    table = doc.pages[52].find_tables()[1]  # PDF 53쪽, 두 번째 표
    xs = sorted({round(c[i], 3) for c in table.cells for i in (0, 2)})
    ys = sorted({round(c[i], 3) for c in table.cells for i in (1, 3)})
    values = table.extract()
    text_by_box = {
        tuple(box): values[r][c]
        for r, row in enumerate(table.rows)
        for c, box in enumerate(row.cells) if box is not None
    }
    cells = []
    for box in sorted(table.cells, key=lambda b: (b[1], b[0])):
        x0, y0, x1, y1 = (round(n, 3) for n in box)
        row, column = ys.index(y0), xs.index(x0)
        cells.append({
            "id": f"r{row}c{column}", "row": row, "column": column,
            "row_span": ys.index(y1) - row,
            "column_span": xs.index(x1) - column,
            "text": text_by_box[tuple(box)], "bbox": [x0, y0, x1, y1],
        })
```

현재 표의 열 역할은 영역 0, 과목명 1, 학점 2, 제외 계열 3입니다. 이수시기 열도 원본 자료에는 보존하지만 현재 인용 조합 검사에는 사용하지 않습니다. 행·열 번호는 0부터 세고 헤더는 0행, PDF 페이지 번호는 1부터 셉니다. 공백 셀과 병합 셀은 다르므로 null 값을 위에서 내려 채우지 않습니다.

## 검사와 한계

- 인덱스의 PDF 해시·판본·출처 ID와 원문 계약을 비교합니다.
- 셀 좌표와 행·열 범위가 일치하는지, 겹치거나 빠진 칸이 없는지 검사합니다.
- 셀의 각 텍스트 줄이 해당 페이지의 추출본에 있는지 검사합니다.
- 인용한 과목과 학점은 같은 행이어야 합니다. 영역과 공통 제외 계열은 인용한 모든 행을 포함해야 합니다.
- 사용한 셀 ID와 인덱스 해시를 결과에 남깁니다.

해시와 좌표의 내부 일관성만으로 PDF 추출 정확성이 자동 인증되지는 않습니다. 인덱스의 원문 대응은 검토가 필요한 입력입니다. 현재 지원 범위는 이 표와 `영역 + 과목·학점 쌍 + 선택적인 공통 제외 계열` 형식이며, 표 밖 각주나 학생별 예외 적용까지 이 검사로 판정하지 않습니다. 모호한 관계를 임의 추정해서 통과시키지 않습니다.
