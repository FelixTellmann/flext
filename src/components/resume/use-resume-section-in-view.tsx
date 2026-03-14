import produce from "immer";
import create from "zustand";

export type ResumeSectionInViewStore = {
  sections: {
    [T: string]: { showing: boolean; centerVisible: boolean; fullyVisible: boolean };
  };
  filter:
    | "relevant"
    | "all"
    | "web / tech dev"
    | "management"
    | "restaurant"
    // | "tech support"
    | "entrepreneurial";
  selectFilter: (filter: ResumeSectionInViewStore["filter"][0]) => void;
  updateSection: (
    id: keyof ResumeSectionInViewStore["sections"],
    showing: boolean,
    centerVisible: boolean,
    fullyVisible: boolean
  ) => void;
  toggleSectionShowing: (id: keyof ResumeSectionInViewStore["sections"]) => void;
  showSection: (id: keyof ResumeSectionInViewStore["sections"]) => void;
};
export const useResumeSectionInView = create<ResumeSectionInViewStore>((set) => ({
  sections: {
    intro: { showing: true, centerVisible: false, fullyVisible: false },
    experience: { showing: true, centerVisible: false, fullyVisible: false },
    projects: { showing: true, centerVisible: false, fullyVisible: false },
    education: { showing: true, centerVisible: false, fullyVisible: false },
    capabilities: { showing: true, centerVisible: false, fullyVisible: false },
    certifications: { showing: true, centerVisible: false, fullyVisible: false },
    references: { showing: true, centerVisible: false, fullyVisible: false },
    interests: { showing: true, centerVisible: false, fullyVisible: false },
  },
  filter: "relevant",
  selectFilter: (filter) => {
    set(
      produce((state) => {
        state.filter = filter;
      })
    );
  },
  updateSection: (id, showing, centerVisible, fullyVisible) => {
    set(
      produce((state) => {
        state.sections[id] = { showing, centerVisible, fullyVisible };
      })
    );
  },
  toggleSectionShowing: (id) => {
    set(
      produce((state) => {
        state.sections[id].showing = !state.sections[id].showing;
      })
    );
  },
  showSection: (id) => {
    set(
      produce((state) => {
        state.sections[id].showing = true;
      })
    );
  },
}));
