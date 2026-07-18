import './App.css'

const timeline = [
  { time: '07.18 14:00', label: '개회식 및 주제 공개', state: 'ready' },
  { time: '07.18 14:30', label: '개발 시작', state: 'next' },
  { time: '07.19 10:00', label: '산출물 마감', state: 'locked' },
  { time: '07.19 10:30', label: '구글폼 제출 완료', state: 'locked' },
]

const roles = [
  { name: '최유빈', task: '기획, 핵심 기능, 제출 문서' },
  { name: '김민창', task: '구현 보조, 자료 정리, 테스트' },
  { name: '최겸', task: 'UI 점검, 발표/시연 흐름, 검수' },
]

const priorities = [
  '주제 공개 직후 20분 안에 문제 정의와 사용자 시나리오 확정',
  '17:00 전까지 클릭 가능한 MVP 완성',
  '22:00 전까지 제출 문서 초안과 시연 흐름 작성',
  '09:30 전까지 빌드, 영상/스크린샷, 구글폼 제출물 최종 확인',
]

function App() {
  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">2026 전국 청소년 SW AI 경진대회</p>
          <h1>HYU-AISW Team Workspace</h1>
          <p className="hero-text">
            주제가 공개되면 이 저장소에서 바로 기획, 구현, 제출 산출물을 한 흐름으로
            관리합니다.
          </p>
          <div className="status-row" aria-label="project status">
            <span>Repo ready</span>
            <span>React + TypeScript</span>
            <span>Private data excluded</span>
          </div>
        </div>
        <div className="signal-card" aria-hidden="true">
          <div className="signal-orbit orbit-a"></div>
          <div className="signal-orbit orbit-b"></div>
          <div className="signal-node node-a"></div>
          <div className="signal-node node-b"></div>
          <div className="signal-node node-c"></div>
          <div className="signal-line"></div>
          <strong>Idea to MVP</strong>
        </div>
      </section>

      <section className="grid-section">
        <article className="panel timeline-panel">
          <div className="panel-heading">
            <span className="panel-kicker">Schedule</span>
            <h2>대회 타임라인</h2>
          </div>
          <ol className="timeline">
            {timeline.map((item) => (
              <li key={item.time} className={`timeline-item ${item.state}`}>
                <time>{item.time}</time>
                <span>{item.label}</span>
              </li>
            ))}
          </ol>
        </article>

        <article className="panel">
          <div className="panel-heading">
            <span className="panel-kicker">Team</span>
            <h2>역할 초안</h2>
          </div>
          <div className="role-list">
            {roles.map((role) => (
              <div className="role-row" key={role.name}>
                <strong>{role.name}</strong>
                <span>{role.task}</span>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="panel priority-panel">
        <div className="panel-heading">
          <span className="panel-kicker">Execution</span>
          <h2>우선순위</h2>
        </div>
        <div className="priority-grid">
          {priorities.map((priority, index) => (
            <div className="priority-card" key={priority}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <p>{priority}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}

export default App
