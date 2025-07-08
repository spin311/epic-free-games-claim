import './App.css';
import OnButton from "@/entrypoints/components/OnButton.tsx";
import {Days, daysArray} from "@/entrypoints/enums/days.ts";
import {useStorage} from "@/entrypoints/hooks/useStorage.ts";

function App() {
    const [day, setDay] = useStorage<Days>("day" ,Days.Friday);
    const [counter, setCounter] = useStorage<number>("counter", 0);

  return (
    <div className="App">
      <h1>Epic Free games claim</h1>
        <p>Games claimed counter: {counter}</p>
        <OnButton/>

        <div className="inputs">
            <button className="manual-btn">Manually claim</button>
            <span className="day-select">
                <label htmlFor="day">Claim free games every: </label>
                <select
                    id="day"
                    value={day}
                    onChange={e => setDay(e.target.value)}
                >
                    {daysArray.map(day => {
                        return <option value={day} key={day}>{day}</option>
                    })}
                </select>
            </span>
        </div>
    </div>
  );
}

export default App;